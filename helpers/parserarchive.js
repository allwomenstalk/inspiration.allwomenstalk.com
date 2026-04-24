const moment = require('moment');

module.exports = function (item) {
    // console.log(item.post_title)
     //console.log(item.super_categories)
     if(!item.super_categories) {console.log(item)}
      const temp = {};
      temp.id = item._id;
      temp.slug = item.post_name;
      temp.tags = [item.super_categories[0]];
      temp.category = item.super_categories[0]
      temp.title = item.post_title;
      temp.fulldate = item.post_date;
      temp.date = moment(item.post_date).format('MMM DD');
      temp.author = { name: item.author.first_name.replace('_', ''), id: item.author._id };
      temp.image = item.image_url;
      temp.imageresize = item.image_url.replace('img.allw.mn', 'resize.allw.mn/400x400');
      if (item.keywords) temp.keyword = capitalize( item.keywords[Math.floor(Math.random() * 5)] );
      if (item.RPM) temp.RPM = item.RPM;
      // temp.content = item.post_content;
      temp.host = item.host
      if (item.url) {
        temp.url = item.url;
      } else {
        temp.url = `https://${item.host}/${item.post_name}/`;
      }

    return temp;
}


function capitalize(word) {
    console.log('word',word)
    return word[0].toUpperCase() + word.substring(1).toLowerCase();
  }
