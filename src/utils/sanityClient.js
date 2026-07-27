require('dotenv').config({
  path: `.env.${process.env.NODE_ENV || 'development'}`
})
const sanityClient = require("@sanity/client");

const { sanity } = require('../../client-config')

/**
 * Set manually. Find configuration in
 * studio/sanity.json or on manage.sanity.io
 */


// const sanity = {
//   projectId: 'i16vzhxd',
//   dataset: 'production',
//   useCdn: true
// }


module.exports = sanityClient({
  ...sanity, // brings in projectId and dataset
  useCdn: false,
  token: process.env.SANITY_READ_TOKEN
});
