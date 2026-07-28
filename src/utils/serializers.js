const imageUrl = require('./imageUrl')
const getYouTubeID = require('get-youtube-id');


// Learn more on https://www.sanity.io/guides/introduction-to-portable-text
module.exports = {
  types: {
    authorReference: ({node}) => `[${node.name}](/authors/${node.slug.current})`,
    code: ({node}) =>
      '```' + node.language + '\n' + node.code + '\n```',
    mainImage: ({node}) => `![${node.alt}](${imageUrl(node).width(600).url()})`,
    iframeEmbed: ({node}) => `<div class="embed">${node.code}</div>`,
    youtube: (({node}) =>  {
      const youtubeId = getYouTubeID(node.url)
      return (`<div class="videoOuterWrapper"><div data-service="youtube" data-id="${youtubeId}" data-autoscale data-ratio="16:9" data-thumbnail="/images/video-placeholder.svg" data-iframe-title="YouTube video"></div></div>`)
    }),
  },
  marks: {
    button: ({mark, children}) => {
      const {href = "#", blank = false} = mark
      const target = blank ? 'target="_blank"' : ''

      return (
        `<a href=${href} class="[ button ] [ button--colored-bg button--color-accent ]" ${target}>${children}</a>`
      )
    }
  }
}
