const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHostList,
  getDeploymentCommand,
  main,
  parseCliArgs,
  processHost,
  processHosts,
  sliceDomainsFromIndex,
} = require('../batchprocess.js');

function createLogger() {
  const logs = [];
  const errors = [];

  return {
    logs,
    errors,
    logger: {
      log(message) {
        logs.push(message);
      },
      error(message) {
        errors.push(message);
      },
    },
  };
}

test('parseCliArgs supports a dry-run single-domain execution', () => {
  assert.deepEqual(parseCliArgs(['--dry-run', 'books.allwomenstalk.com']), {
    dryRun: true,
    fromIndex: undefined,
    requestedDomain: 'books.allwomenstalk.com',
  });
});

test('parseCliArgs supports resuming from a 1-based index', () => {
  assert.deepEqual(parseCliArgs(['--from-index', '25']), {
    dryRun: false,
    fromIndex: 25,
    requestedDomain: '',
  });
});

test('parseCliArgs rejects combining from-index with a single domain', () => {
  assert.throws(
    () => parseCliArgs(['--from-index', '25', 'gardening.allwomenstalk.com']),
    /--from-index cannot be used with a specific domain/,
  );
});

test('sliceDomainsFromIndex returns domains from the requested 1-based offset', () => {
  assert.deepEqual(
    sliceDomainsFromIndex(
      ['one.allwomenstalk.com', 'two.allwomenstalk.com', 'three.allwomenstalk.com'],
      2,
    ),
    ['two.allwomenstalk.com', 'three.allwomenstalk.com'],
  );
});

test('sliceDomainsFromIndex rejects indexes beyond the available domains', () => {
  assert.throws(
    () => sliceDomainsFromIndex(['one.allwomenstalk.com'], 2),
    /out of range/,
  );
});

test('buildHostList returns a single requested domain', () => {
  const hosts = buildHostList({
    requestedDomain: 'books.allwomenstalk.com',
    cfHosts: [{ domain: 'ignored.allwomenstalk.com' }],
    s3Hosts: ['allwomenstalk.com'],
  });

  assert.deepEqual(hosts, ['books.allwomenstalk.com']);
});

test('buildHostList merges and deduplicates configured domains', () => {
  const hosts = buildHostList({
    cfHosts: [
      { domain: 'books.allwomenstalk.com' },
      { domain: 'fitness.allwomenstalk.com' },
      { domain: 'allwomenstalk.com' },
    ],
    s3Hosts: ['allwomenstalk.com', 'lifestyle.allwomenstalk.com'],
  });

  assert.deepEqual(hosts, [
    'books.allwomenstalk.com',
    'fitness.allwomenstalk.com',
    'allwomenstalk.com',
    'lifestyle.allwomenstalk.com',
  ]);
});

test('getDeploymentCommand selects git for non-s3 domains and s3 for s3 domains', () => {
  assert.deepEqual(
    getDeploymentCommand('books.allwomenstalk.com', ['allwomenstalk.com']),
    {
      type: 'git',
      command: 'sh',
      args: ['batchcommitforce.sh', 'books.allwomenstalk.com'],
    },
  );

  assert.deepEqual(
    getDeploymentCommand('allwomenstalk.com', ['allwomenstalk.com']),
    {
      type: 's3',
      command: 'aws',
      args: [
        's3',
        'cp',
        '_site/allwomenstalk.com',
        's3://allwomenstalk.com',
        '--recursive',
      ],
    },
  );
});

test('processHost runs generate, deploy, and cleanup once for a git host', async () => {
  const runCalls = [];
  const cleanups = [];
  const { logger, errors } = createLogger();

  const result = await processHost({
    domain: 'books.allwomenstalk.com',
    index: 1,
    total: 1,
    s3Hosts: ['allwomenstalk.com'],
    logger,
    logDir: '/tmp/batchprocess-tests',
    createLogFileImpl: (domain) => `/tmp/${domain}.log`,
    appendLogLineImpl: () => {},
    runCommandImpl: async (command, args, options) => {
      runCalls.push({ command, args, options });
    },
    cleanupSiteDirImpl: (domain) => {
      cleanups.push(domain);
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(runCalls, [
    {
      command: 'node',
      args: ['batchgeneratehost.js', 'books.allwomenstalk.com'],
      options: { logFilePath: '/tmp/books.allwomenstalk.com.log' },
    },
    {
      command: 'sh',
      args: ['batchcommitforce.sh', 'books.allwomenstalk.com'],
      options: { logFilePath: '/tmp/books.allwomenstalk.com.log' },
    },
  ]);
  assert.deepEqual(cleanups, ['books.allwomenstalk.com']);
  assert.deepEqual(errors, []);
});

test('processHost runs s3 deployment for s3 hosts', async () => {
  const runCalls = [];
  const { logger } = createLogger();

  const result = await processHost({
    domain: 'allwomenstalk.com',
    index: 1,
    total: 1,
    s3Hosts: ['allwomenstalk.com'],
    logger,
    logDir: '/tmp/batchprocess-tests',
    createLogFileImpl: (domain) => `/tmp/${domain}.log`,
    appendLogLineImpl: () => {},
    runCommandImpl: async (command, args, options) => {
      runCalls.push({ command, args, options });
    },
    cleanupSiteDirImpl: () => {},
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(runCalls, [
    {
      command: 'node',
      args: ['batchgeneratehost.js', 'allwomenstalk.com'],
      options: { logFilePath: '/tmp/allwomenstalk.com.log' },
    },
    {
      command: 'aws',
      args: ['s3', 'cp', '_site/allwomenstalk.com', 's3://allwomenstalk.com', '--recursive'],
      options: { logFilePath: '/tmp/allwomenstalk.com.log' },
    },
  ]);
});

test('processHosts continues after a host failure and reports it in the summary', async () => {
  const { logger, errors } = createLogger();

  const summary = await processHosts(['ok.allwomenstalk.com', 'bad.allwomenstalk.com'], {
    s3Hosts: ['allwomenstalk.com'],
    logger,
    logDir: '/tmp/batchprocess-tests',
    createLogFileImpl: (domain) => `/tmp/${domain}.log`,
    appendLogLineImpl: () => {},
    cleanupSiteDirImpl: () => {},
    runCommandImpl: async (command, args, options) => {
      if (args[1] === 'bad.allwomenstalk.com') {
        const error = new Error('simulated failure');
        error.logFilePath = options.logFilePath;
        error.tail = 'last error line';
        throw error;
      }
    },
  });

  assert.equal(summary.successful.length, 1);
  assert.equal(summary.failed.length, 1);
  assert.match(errors.join('\n'), /bad\.allwomenstalk\.com/);
  assert.match(errors.join('\n'), /last error line/);
});

test('main resumes processing from the requested index', async () => {
  const summary = await main(['--dry-run', '--from-index', '2'], {
    s3Hosts: [],
    readFileSync: () => JSON.stringify([
      { domain: 'one.allwomenstalk.com' },
      { domain: 'two.allwomenstalk.com' },
      { domain: 'three.allwomenstalk.com' },
    ]),
    writeFileSync: () => {},
    createLogFileImpl: (domain) => `/tmp/${domain}.log`,
    appendLogLineImpl: () => {},
    cleanupSiteDirImpl: () => {},
    runCommandImpl: async () => {},
    processHost: undefined,
    logger: {
      log() {},
      error() {},
    },
  });

  assert.deepEqual(
    summary.successful.map((result) => result.domain),
    ['two.allwomenstalk.com', 'three.allwomenstalk.com'],
  );
});
