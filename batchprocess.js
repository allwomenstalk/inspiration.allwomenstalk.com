const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { finished } = require('stream/promises');
const { parseArgs } = require('util');

const DEFAULT_S3_HOSTS = [
  'allwomenstalk.com',
  'lifestyle.allwomenstalk.com',
];

const HOSTS_PATH = path.join(__dirname, 'cloudflare', 'hosts.json');
const PROFILES_PATH = path.join(__dirname, 'src', '_data', 'profiles.json');
const SITE_ROOT = path.join(__dirname, '_site');
const BATCH_LOG_DIR = path.join(__dirname, 'logs', 'batchprocess');
const MAX_ERROR_LINES = 20;

function buildHostList({ cfHosts, requestedDomain, s3Hosts = DEFAULT_S3_HOSTS }) {
  const domain = requestedDomain && requestedDomain.trim();
  if (domain) {
    return [domain];
  }

  const cfDomains = cfHosts
    .map((host) => host && host.domain)
    .filter(Boolean);

  return [...new Set([...cfDomains, ...s3Hosts])];
}

function loadConfiguredHosts({
  requestedDomain,
  hostsFilePath = HOSTS_PATH,
  readFileSync = fs.readFileSync,
  s3Hosts = DEFAULT_S3_HOSTS,
}) {
  const data = readFileSync(hostsFilePath, 'utf8');
  const cfHosts = JSON.parse(data);
  return buildHostList({ cfHosts, requestedDomain, s3Hosts });
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'dry-run': {
        short: 'n',
        type: 'boolean',
      },
      'from-index': {
        type: 'string',
      },
    },
  });

  if (positionals.length > 1) {
    throw new Error('Usage: node batchprocess.js [--dry-run] [--from-index N] [domain]');
  }

  const requestedDomain = positionals[0] || '';
  const fromIndexRaw = values['from-index'];
  let fromIndex;

  if (fromIndexRaw !== undefined) {
    if (requestedDomain) {
      throw new Error('--from-index cannot be used with a specific domain');
    }

    fromIndex = Number.parseInt(fromIndexRaw, 10);
    if (!Number.isInteger(fromIndex) || fromIndex < 1) {
      throw new Error('--from-index must be a positive integer');
    }
  }

  return {
    dryRun: values['dry-run'] || false,
    fromIndex,
    requestedDomain,
  };
}

function sliceDomainsFromIndex(domains, fromIndex) {
  if (fromIndex === undefined) {
    return domains;
  }

  if (fromIndex > domains.length) {
    throw new Error(`--from-index ${fromIndex} is out of range for ${domains.length} host(s)`);
  }

  return domains.slice(fromIndex - 1);
}

function resetProfiles({
  filePath = PROFILES_PATH,
  writeFileSync = fs.writeFileSync,
}) {
  writeFileSync(filePath, '[]\n', 'utf8');
}

function cleanupSiteDir(
  domain,
  { siteRoot = SITE_ROOT, rmSync = fs.rmSync } = {},
) {
  rmSync(path.join(siteRoot, domain), { recursive: true, force: true });
}

function createHostLogFile(
  domain,
  {
    logDir = BATCH_LOG_DIR,
    mkdirSync = fs.mkdirSync,
    writeFileSync = fs.writeFileSync,
  } = {},
) {
  const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
  const logFilePath = path.join(logDir, `${safeDomain}.log`);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(logFilePath, '', 'utf8');
  return logFilePath;
}

function appendLogLine(
  logFilePath,
  line,
  { appendFileSync = fs.appendFileSync } = {},
) {
  appendFileSync(logFilePath, `${line}\n`, 'utf8');
}

function updateTail(tail, text, maxLines = MAX_ERROR_LINES) {
  return `${tail}${text}`.split(/\r?\n/).slice(-maxLines).join('\n');
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

async function runCommand(
  command,
  args,
  { cwd = __dirname, logFilePath } = {},
) {
  if (!logFilePath) {
    throw new Error('logFilePath is required');
  }

  await fs.promises.mkdir(path.dirname(logFilePath), { recursive: true });

  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  const startedAt = new Date().toISOString();
  logStream.write(`\n[${startedAt}] $ ${command} ${args.join(' ')}\n`);

  let tail = '';
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const handleOutput = (chunk) => {
    const text = chunk.toString();
    logStream.write(text);
    tail = updateTail(tail, text);
  };

  child.stdout.on('data', handleOutput);
  child.stderr.on('data', handleOutput);

  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
  } catch (error) {
    logStream.write(`\n[${new Date().toISOString()}] command failed: ${error.message}\n`);
    logStream.end();
    await finished(logStream);

    error.logFilePath = error.logFilePath || logFilePath;
    error.tail = error.tail || tail.trim();
    throw error;
  }

  logStream.write(`\n[${new Date().toISOString()}] exit code ${exitCode}\n`);
  logStream.end();
  await finished(logStream);

  if (exitCode !== 0) {
    const error = new Error(
      `${command} ${args.join(' ')} exited with code ${exitCode}`,
    );
    error.code = exitCode;
    error.logFilePath = logFilePath;
    error.tail = tail.trim();
    throw error;
  }

  return { logFilePath };
}

function getLogger(logger = console) {
  return {
    info: logger.info ? logger.info.bind(logger) : logger.log.bind(logger),
    error: logger.error ? logger.error.bind(logger) : logger.log.bind(logger),
  };
}

function getDeploymentCommand(domain, s3Hosts) {
  if (s3Hosts.includes(domain)) {
    return {
      type: 's3',
      command: 'aws',
      args: ['s3', 'cp', `_site/${domain}`, `s3://${domain}`, '--recursive'],
    };
  }

  return {
    type: 'git',
    command: 'sh',
    args: ['batchcommitforce.sh', domain],
  };
}

async function processHost({
  domain,
  index,
  total,
  s3Hosts = DEFAULT_S3_HOSTS,
  dryRun = false,
  logger = console,
  logDir = BATCH_LOG_DIR,
  runCommandImpl = runCommand,
  cleanupSiteDirImpl = cleanupSiteDir,
  createLogFileImpl = createHostLogFile,
  appendLogLineImpl = appendLogLine,
}) {
  const output = getLogger(logger);
  const logFilePath = createLogFileImpl(domain, { logDir });
  const deployment = getDeploymentCommand(domain, s3Hosts);
  const label = `[${index}/${total}] ${domain}`;
  const startedAt = Date.now();

  output.info(`${label} start`);

  try {
    if (dryRun) {
      appendLogLineImpl(logFilePath, `[dry-run] node batchgeneratehost.js ${domain}`);
      appendLogLineImpl(
        logFilePath,
        `[dry-run] ${deployment.command} ${deployment.args.join(' ')}`,
      );
    } else {
      await runCommandImpl('node', ['batchgeneratehost.js', domain], { logFilePath });
      output.info(`${label} deploy -> ${deployment.type}`);
      await runCommandImpl(deployment.command, deployment.args, { logFilePath });
      cleanupSiteDirImpl(domain);
    }

    output.info(
      `${label} done in ${formatDuration(Date.now() - startedAt)} (${path.relative(
        __dirname,
        logFilePath,
      )})`,
    );

    return {
      domain,
      logFilePath,
      status: 'ok',
      deploymentType: deployment.type,
    };
  } catch (error) {
    output.error(
      `${label} failed in ${formatDuration(Date.now() - startedAt)} (${path.relative(
        __dirname,
        error.logFilePath || logFilePath,
      )})`,
    );

    if (error.tail) {
      output.error(error.tail);
    }

    return {
      domain,
      logFilePath,
      status: 'failed',
      deploymentType: deployment.type,
      error,
    };
  }
}

async function processHosts(domains, options = {}) {
  const output = getLogger(options.logger);
  const startedAt = Date.now();
  const results = [];

  for (const [index, domain] of domains.entries()) {
    const result = await processHost({
      ...options,
      domain,
      index: index + 1,
      total: domains.length,
    });
    results.push(result);
  }

  const successful = results.filter((result) => result.status === 'ok');
  const failed = results.filter((result) => result.status === 'failed');

  output.info(
    `Summary: ${successful.length}/${domains.length} hosts succeeded in ${formatDuration(
      Date.now() - startedAt,
    )}`,
  );

  if (failed.length > 0) {
    output.error(`Failed hosts: ${failed.map((result) => result.domain).join(', ')}`);
  }

  return {
    total: domains.length,
    successful,
    failed,
    results,
  };
}

async function main(argv = process.argv.slice(2), options = {}) {
  const { dryRun, requestedDomain, fromIndex } = parseCliArgs(argv);
  const output = getLogger(options.logger);
  const configuredDomains = loadConfiguredHosts({
    requestedDomain,
    s3Hosts: options.s3Hosts,
    readFileSync: options.readFileSync,
    hostsFilePath: options.hostsFilePath,
  });
  const domains = sliceDomainsFromIndex(configuredDomains, fromIndex);

  if (domains.length === 0) {
    throw new Error('No hosts to process.');
  }

  if (dryRun) {
    output.info('Dry run enabled. No files or remote targets will be modified.');
  } else {
    resetProfiles({
      writeFileSync: options.writeFileSync,
      filePath: options.profilesPath,
    });
  }

  output.info(`Processing ${domains.length} host(s)`);

  const summary = await processHosts(domains, {
    ...options,
    dryRun,
  });

  if (summary.failed.length > 0) {
    const error = new Error(`${summary.failed.length} host(s) failed.`);
    error.summary = summary;
    throw error;
  }

  return summary;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_S3_HOSTS,
  appendLogLine,
  buildHostList,
  cleanupSiteDir,
  createHostLogFile,
  formatDuration,
  getDeploymentCommand,
  loadConfiguredHosts,
  main,
  parseCliArgs,
  processHost,
  processHosts,
  resetProfiles,
  runCommand,
  sliceDomainsFromIndex,
  updateTail,
};
