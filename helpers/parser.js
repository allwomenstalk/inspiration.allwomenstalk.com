const tags = require('./tags.js')
const { marked } = require('marked');

marked.use({
  mangle: false,
  headerIds: false
});

module.exports = function (item) {
      //post process
      const temp = {};
      temp.id = item._id;
      temp.slug = item.post_name;
      temp.category = [item.super_categories[0]];
      if(item.keywords && item.keywords.length>0) {
        temp.keywords = item.keywords
                          .sort((a, b) => (a.impressions > b.impressions) ? 1 : -1)
                          .slice(0,5)
                          .map(kw=>kw.query)
      }

      //special tags check 
      if (item.tags.includes('_noads')) { temp.noads = true }
      if (item.tags.includes('_noaff')) { temp.noaff = true }
      if (item.tags.includes('_noelaborate')) { temp.noelaborate = true }
      //tags filter and formating 
      temp.tags = item.tags
          .filter(tag=>tag.slice(0,1)!=="_")
          .filter(tag=>tags.includes(tag))
          .map(tag=> tag = {name:tag.replace(/-/g," "), tag:tag});

      
      temp.host = item.host?item.host:(item.blog=="aws"?"allwomenstalk.com":item.blog+".allwomenstalk.com")
      // temp.host = item.host
      
      temp.url = `https://${temp.host}/${item.post_name}`;
      temp.amp_url = `https://${temp.host}/${item.post_name}/amp.html`;
      
      temp.title = item.post_title.trim();
      temp.viral = item.viral_title;
      if (typeof item.post_date === 'string') {
        item.post_date = new Date(item.post_date);
      }
      temp.date = item?.post_date
        ? new Date(item.post_date).toISOString()
        : null;
      temp.modified = new Date().toISOString();

      temp.author = {
        name: (item.author?.first_name || '').replace('_', ''),
        id: item.author?._id || null
      };
      temp.image = item.image_url || false;
      temp.video_url = item.video_url;
      temp.comment_count = item.comment_count;

      // collections 
      if (item.classify&&item.classify.collection) {
        temp.collection = item.classify.collection?item.classify.collection[0]:[];
        temp.collection = temp.collection.map(el=>{
          return {
            name:el,
            slug:slugify(el)}
        })
        collectionslugsarr = temp.collection.map(el=>el.slug) // save collection slugs for later use
        temp.collection.forEach((c,i)=> {
          c.slug = collectionslugsarr.slice(0,i+1).join("/")
        })
      }
      if (item.image_url) {
        sizearr = GetImageSize(item.image_url)

        temp.imagesize = {
          width:sizearr[0],
          height:sizearr[1]
        };
      } else {
        temp.imagesize = false;
      }
    
      temp.rating = 5-Math.round(Math.random())
      temp.ratingstars = "★".repeat(temp.rating)+"☆".repeat(5-temp.rating)
      if (item.image_url) {
        temp.imagesource = item.image_url.replace('.jpg','.json')
        temp.imageresize = item.image_url.replace('img.allw.mn', 'resize.allw.mn/400x400');
        temp.imagewebp400  = item.image_url.replace('//img.allw.mn/', '//resize.allw.mn/filters:format(webp)/filters:quality(70)/400x400/');
        temp.imagewebp800  = item.image_url.replace('//img.allw.mn/', '//resize.allw.mn/filters:format(webp)/filters:quality(70)/800x800/');
        temp.imagewebp1200 = item.image_url.replace('//img.allw.mn/', '//resize.allw.mn/filters:format(webp)/filters:quality(70)/1200x1200/');
      } else {
        temp.imagesource = false;
        temp.imageresize = false;
        temp.imagewebp400 = false;
        temp.imagewebp800 = false;
        temp.imagewebp1200 = false;
      }

      // remove imgage if it's contain {image_url:/_400x400.jpg|_400x300.jpg/}
      if (item.image_url && item.image_url.match(/_400x400.jpg|_400x300.jpg|720x720.jpg/)) {
        temp.image = false
        temp.imagewebp400 = false
        temp.imagewebp800 = false
        temp.imagewebp1200 = false
        temp.imagesize = false
      }
      // converting contet to string for processing 
      item.post_content = item.post_content.join('')

      // crosslinks
      
      if (item.crosslinks) {
        // console.log('crosslinks:',item.crosslinks)
        uniquetargets = [...new Set(item.crosslinks.map(el=>el.page))]

        for (target of uniquetargets) {
          obj = item.crosslinks.find(el=>el.page==target)
          item.post_content = item.post_content.replace(obj.link.original,obj.link.replace)
        }
      }
      
      // meta description 
      if (item.meta_description) {
        temp.description = item.meta_description
      }

      // meta_title 
      if (item.meta_title) {
        temp.meta_title = item.meta_title
      }
      

      //makig list for TOC
      var toc = item.post_content
        .match(/<h2>.*?<\/h2>/g)
                    
      if (toc && toc.length > 0 ) {
        temp.toc = [...toc.map(i=>i
          .replace(/<\/?h2>?([0-9]+\.)?/g,'') //remving h2 nad nubmer 
          .replace(/<[^>]*>/g,'') // removing anything else like A tag
          .trim())];
        
        // slice long toc 
        if (temp.toc.length > 10) {
          temp.toc = temp.toc.slice(0,10)
          temp.toc.push("More ...")
        }
        // item.post_content = item.post_content.replace(/<h2>/,tochtml+"<h2>")

        // disable toc if it's just list of numbers
        if (temp.toc[0].match(/^#[0-9]+$/)) delete temp.toc // disable toc if it matches "#[anynumber]"

        // use table fo content for meta description if it's not set before
        if (!temp.description) {
          temp.description = toc
            .map(i=>i.replace(/<\/?h2>?([0-9]+\.)?/g,'').trim())
            .slice(0,5)
            .join(" • ") + " • More ... "
        }
      } 


      temp.postContent = item.post_content 
        //.replace(/<div class=\"embed\" data-media-type=\"instagram\" data-media-url=\"https:\/\/www.instagram.com\/p\/(.*?)\/">(.*?)?<\/div>/g, 
        //  '<amp-instagram data-shortcode="$1" width="1" height="1" layout="responsive"></amp-instagram>')
        .replace(/(<h2.*?>)\s*(\d*)\./g,'$1<span class="pointnum">$2</span>') //make big point numbers
        .replace(
          /<div class="embed" data-media-type="youtube" data-media-url="https:\/\/www\.youtube\.com\/watch\?v=([^"]+)"[^>]*>.*?<\/div>/g,
          '<amp-youtube data-videoid="$1" layout="responsive" width="480" height="270"></amp-youtube>'
        )
        .replace(/<div class=\"embed\" data-media-type=\"instagram\" data-media-url="https?:\/\/(www\.)?instagram\.com\/p\/(.*?)\/.*?">(.*?)?<\/div>/g, 
        '<p><amp-instagram data-shortcode="$2" width="1" height="1" layout="responsive"></amp-instagram></p>')
        .replace(/<iframe(.*?)><\/iframe>/g,"<amp-iframe $1 layout=\"responsive\"></amp-iframe>")
        

        // .replace(/(<img[^>]+) class=".*?"(.*?\/>)/g,"$1$2") //removing class for all images
        // .replace(/(<img[^>]+)(?<!\/)>/g,"$1/>") //close all unclosed img tags

          // temp.content = item.post_content;
      //adding Table of content
      
      temp.contentamp = temp.postContent
        .replace(/<img([^>]+)\/>/g,"<amp-img $1 layout=\"responsive\"><noscript><img $1 ></noscript></amp-img>")
        .replace(/src="(.*?)(\d*)x(\d*)\.(jpg|gif|png)"/g, 'src="$1$2x$3.$4" width="$2" height="$3"')
        .split(/(?=<h2)/g)

      // extra convertion for non amp pages only 
      temp.postContent = temp.postContent
        // lazy loading for images
        .replace(/src="(.*?)(\d*)x(\d*)\.(jpg|gif|png)"/g, 'src="$1$2x$3.$4" width="$2" height="$3" loading="lazy"')
        // adding wepb for images
        .replace(/(<img src=")https:\/\/img\.allw\.mn\/content\/([^"]+)(\.jpg")/g, 
                  '$1https://resize.allw.mn/1028x0/filters:format(webp)/filters:quality(70)/content/$2$3');

      // breaking into pages
      temp.postContent = temp.postContent
        // .replace(/<img ([^>]+)\/>/g, "<img $1 class='rounded-lg my-2' loading='lazy' decoding='async'/>") //adding lazy and async 
        // .replace(/<img src="(.*?)(\d*)x(\d*)\.(jpg|png)"(.*?)\/>/g,
        //   '<picture><source type="image/webp" srcset="$1$2x$3.$4"><img src="$1$2x$3.$4"$5></picture>')
        // .replace(/type="image\/webp" srcset="https:\/\/img\.allw\.mn\//g,
        //   'type="image\/webp" srcset="https://resize.img.allw.mn/fit-in/600x0/filters:format(webp)/filters:quality(70)/')
        .split(/(?=<h2)/g)

      // ellaorate parts 
      temp.elaborate = {}
      temp.postContent.forEach((page,index) => {
        //filter by pageNumber
        // if (item.elaborate.publish){ // only if it's published
          extra = item.elaborate.filter(i=>i.pageNumber == index)?.[0]
        if (extra && extra.publish) {
          // console.log(extra)
          html = extra?.response?.[0]?marked(extra?.response?.[0]):''
          if (typeof extra.date === 'string') {
            extra.date = new Date(extra.date);
          }
          
          if (html) temp.elaborate[index] = {
            html: html,
            date: extra.date.toLocaleDateString(),
          }
        }
      })

      // temp.url = `${
      //   (item.blog === 'aws'
      //     ? 'https://allwomenstalk.com/'
      //     : `https://${item.blog}.allwomenstalk.com/`) + item.post_name
      // }/`;

      temp.url = `https://${item.host}/${item.post_name}/`;

      temp.SchemaObjects = [] //additional schemas

      // video objects 
      temp.pages = [] // array of pages for structured pages
    
      temp.postContent.forEach((page, index) => {

          if (page.includes('amp-youtube')) {

              temp.ampyt = true
              subtitle = page.match(/span>(.*?)</)
              videoid = page.match(/videoid=\"(.*?)\"/)[1]

              VideoObject = {
                  "@context": "https://schema.org",
                  "@type": "VideoObject",
                  "name": subtitle ? subtitle[1].trim() : 'none',
                  "description": subtitle ? subtitle[1].trim() : 'none',
                  "thumbnailUrl": `https://img.youtube.com/vi/${videoid}/0.jpg`,
                  "embedUrl": `https://www.youtube.com/embed/${videoid}`,
                  "uploadDate": temp.date
              }
              temp.SchemaObjects.push(JSON.stringify(VideoObject, null, 4))
          }



          // convert to object 
          temp.pages.push({
              pageContent: page,
          })
        title = page.match(/<h2>(.*?)<\/h2>/)
        // remove <span> from title
        if (title) {
          // extrac span text from title 
          number = title[1].match(/<span.*?span>/g)
          if (number) {
            number = number[0].replace(/<span.*?>(.*?)<\/span>/g,'$1')
            temp.pages[index].number = number
          }
          title = title[1].replace(/<span.*?span>/g,'')
          // remove title from pageContent
          temp.pages[index].pageContent = temp.pages[index].pageContent.replace(/<h2>.*?<\/h2>/,'')
          temp.pages[index].title = title
        }

      })
      
      // words count and ads 
      totalwords = 0
      lastAdWords = 0 // Track the word count when the last ad was encountered

      if (temp.pages.length > 0) {
        temp.pages.forEach((page, index) => {
            let words = 0

            if (temp.elaborate && temp.elaborate[index] && temp.elaborate[index].html) {
                // Count words in the 'html' field of elaborate[index]
                words = temp.elaborate[index].html.match(/\w+/g).length
            }

            // Add words from 'pageContent' field of the current page
            // console.log('page:',page.pageContent, page.pageContent.length)
            if (page.pageContent.trim().length > 20) {
              words += page.pageContent.match(/\w+/g).length
              totalwords += words

              // Determine if this page should have an ad
              let ads = false
              if (totalwords - lastAdWords >= 200 || index === 0 ) {
                  ads = true
                  lastAdWords = totalwords // Update lastAdWords to the current total
              }
            

              // Update the page object with new fields
              page.length = words
              page.total = totalwords
              page.ads = ads
            }
        })
      }


      // related videos 

      if (item.videos) {
        temp.videos = item.videos
        // temp.videos.forEach(video => {
        //   video.items = video.items.slice(0,2)
        // })

      if (temp.videos.length > 0) {
        temp.ampyt = true
        temp.amp = true
      }
        // console.log('videos inside:',temp.videos.length)
      }
      
      // recipe schema 
      if (item.tags.includes('_schemarecipes')) {
        
        recipeSchemaObj = {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "headline": temp.title,
              "name": temp.title,
              "image": [
                temp.imageresize+"?width=1000&height=562", //16x9 ratio
                temp.imageresize+"?width=1000&height=750", //4x3 ratio
                temp.imageresize+"?width=1000&height=1000"], //1x1 ratio
              "genre": "food",
              //"keywords": temp.keywords.map(tag=>tag.name),
              "mainEntityOfPage": "true",
              "url": temp.url,
              "datePublished": temp.date,
              "dateCreated": temp.date,
              "dateModified": temp.modified,
              "description": temp.description,
              "meta_title": temp.meta_title,
              "publisher": {
                   "@type": "Organization",
                   "name": "All Women's Talk",
                   "url": "https://allwomenstalk.com/",
                   "logo": {
                        "@type": "ImageObject",
                        "url": "https://storage.googleapis.com/aws-static/images/logo-amp.png"
                   }
              },
              "author": {
                   "@type": "Person",
                   "name": temp.author.name
              },
              "aggregateRating": {
                  "@type": "AggregateRating",
                  "ratingValue": Math.floor(Math.random() * (50 - 40 + 1))/10 + 4,
                  "ratingCount": Math.floor(Math.random() * (60 - 30 + 1)) + 30
              }
         }
        temp.SchemaObjects.push(JSON.stringify(recipeSchemaObj,null,4))

      }


      // list schema 
      if (toc && toc.length > 0) {
        listSchemaObj = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": 
          toc
          .map(i=>i.replace(/<\/?h2>?([0-9]+\.)?/g,'').trim())
          .map((item,index)=> {
            return {
              "@type": "ListItem",
              "position": index+1,
              "item": {
                  "@type": "Thing",
                  "url": temp.url+"#"+(index+1),
                  "name": item
              }
            }
          })
        }
        temp.SchemaObjects.push(JSON.stringify(listSchemaObj))
      }

      // faq schema
      if (item.faq.length > 0) {
        faqSchemaObj = {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "mainEntity": item.faq[0].list.map((item,index)=>{
            return {
              "@type": "Question",
              "name": item.question,
              "acceptedAnswer": {
                "@type": "Answer",
                "text": item.answer
              }
            }
          })
        }
        temp.SchemaObjects.push(JSON.stringify(faqSchemaObj))
      }

      if (temp.postContent.join('').includes('amp-instagram')) temp.ampig = true
      if (temp.postContent.join('').includes('amp-iframe')) temp.ampif = true
      if (temp.postContent.join('').includes('<amp-')) temp.amp = true 
      
      // related posts
      temp.related = {}
      temp.related.posts = []
      
      if (item.clusterlinks && item.clusterlinks.length>0) {
        temp.related.clusterlinks = item.clusterlinks[0].posts.map(item=>mapRelatedPosts(item))
      }
      
      if (item.related && item.related.length > 0) {
        // console.log('related',item._id)
        temp.related.posts = item.related
          //.sort( () => .5 - Math.random() )
          //.slice(0,5)
          .map(item => {
            return mapRelatedPosts(item)
          })
          // sort by post date 
          .sort((a,b)=>b.post_date-a.post_date)
          // .sort( () => .5 - Math.random() ) //shuffle order of related posts by
      }
      // filter out older then 2018
      // temp.related.posts = temp.related.posts.filter(el=>el.post_date.getFullYear()>2018)
      temp.related.pagescount = temp.postContent.length
      temp.related.afterposts = temp.related.posts.slice(temp.postContent.length)
      temp.related.inline = false
      
      // interlinks first 
      // if (item.interlinks.length > 0 ) {
      //   // filter out link to current post 
      //   item.interlinks = item.interlinks.filter(el=>el.postid!=item._id)
      //   if (item.interlinks.length !== 0 )  {
      //     random_link = item.interlinks[0]
      //     temp.related.inline = marked(random_link.content)
      //   }
      // }

      // related inline repalce interlink if exits 
      if (item.interlinks && item.interlinks.length > 0) {
        temp.related.inline = marked(item.interlinks[0].content)
      }
      

      // split to 2 section 
      // temp.related.inline = temp.related.posts.slice(0,2)
      // temp.related.posts = temp.related.posts.slice(2,8)

      //comments list 
      temp.pagecomments = Array (temp.postContent.length) // array for inline comments
      item.comments.forEach((el,i)=>{
        anchor = /^#(\d*)[\. ]/
        if (el.comment_content.match(anchor)) { //inline comments, one per page
          //console.log(el.comment_content)
          pageindex = el.comment_content.match(anchor)[1]
          temp.pagecomments[pageindex] = `<div class="mt-4 text-sm">
            <b>${el.comment_author.split(' ')[0]}</b> 
            <span class="opacity-70">${el.comment_content.replace(anchor,'').slice(0,50)}<a href="#comments">...</a></span>
            </div>`
        }
        el.comment_author = el.comment_author.split(' ')[0]
        el.comment_content = el.comment_content
                        .replace(/^#([0-9]{1,2})/,
                        "<a href=\"#$1\" class=\"rounded bg-pink-600 text-white text-white p-1\">#$1</a>")
        answers = item.comments.filter(comment=>comment.comment_parent==el._id+'')
        if(answers.length>0) {
          el.replies = []
          item.comments
          .filter(comment=>comment.comment_parent==el._id+'')
          .forEach(reply => {
            el.replies.push(reply)
            var indexofreply = item.comments.findIndex(el=>el._id===reply._id)
          })
          
        }
      })
      
      // comments
      temp.comments = item.comments.filter(el=>!el.comment_parent)
      temp.postContent.map(el=>{
        return {
          page: el,
          related:temp.related
        }
      })

      // faq 
      // console.log('faq',item.faq, item.faq.length)
      if (item.faq.length > 0) temp.faq = item.faq.shift().list
      // if (item.seo && item.seo.clicks == 0 && item.seo.ga_visits == 0) temp.noads = true 
      return temp
}    

function mapRelatedPosts(item) {
  obj = {}
  // console.log('related',item._id, item.post_title)
  // console.log(item)
  obj.post_date = item.post_date
  obj.post_modified = item.post_modified
  obj.title = item.post_title.trim();
  if (obj.title.length > 50) obj.title = obj.title.slice(0,50) + '...'
  

  if (item.keywords && item.keywords.length>0) {
    obj.title = capitalize(item.keywords[0].query)
  }
  if (item.image_url) {
    obj.image = item.image_url.replace('img.allw.mn','resize.allw.mn/100x100');  
    obj.webp = item.image_url.replace('img.allw.mn/','resize.allw.mn/100x100/filters:format(webp)/filters:quality(70)/');  
  }
  obj.url   = item.url;

  if (item.super_categories) obj.category = item.super_categories[0]
  
  return obj
}

function GetImageSize(imgurl) {
  var imagename = imgurl.split("/").pop().split(".")[0]
  var sizearr = []
  imagename.split("_").length == 2 ? sizearr = imagename.split("_")[1].split("x") : sizearr = imagename.split("_").slice(1,3)
  return sizearr
}

function capitalize(word) {
  return word[0].toUpperCase() + word.substring(1).toLowerCase();
}

function slugify(str) {
  // console.log('str:',str)
  return str.toLowerCase()
  .replace(/\s+/g, '-')           // Replace spaces with -
  .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
  .replace(/\-\-+/g, '-')         // Replace multiple - with single -
  .replace(/^-+/, '')             // Trim - from start of text
  .replace(/-+$/, '')
}
