'use strict';
// S3Adapter
//
// Stores Parse files in AWS S3.

var AWS = require('aws-sdk');
const DEFAULT_S3_REGION = "us-east-1";

var tinify = require("tinify");
tinify.key = process.env.TINYPNG_API_KEY; // REPLACE WITH YOUR TINYPNG API KEY


function requiredOrFromEnvironment(options, key, env) {
  options[key] = options[key] || process.env[env];
  if (!options[key]) {
    throw `S3AdapterTiny requires option '${key}' or env. variable ${env}`;
  }
  return options;
}

function fromEnvironmentOrDefault(options, key, env, defaultValue) {
  options[key] = options[key] || process.env[env] || defaultValue;
  return options;
}

function optionsFromArguments(args) {
  let options = {};
  let accessKeyOrOptions = args[0];
  if (typeof accessKeyOrOptions == 'string') {
    options.accessKey = accessKeyOrOptions;
    options.secretKey = args[1];
    options.bucket = args[2];
    let otherOptions = args[3];
    if (otherOptions) {
      options.bucketPrefix = otherOptions.bucketPrefix;
      options.directAccess = otherOptions.directAccess;
      options.baseUrl = otherOptions.baseUrl;
    }
  } else {
    options = accessKeyOrOptions || {};
  }
  options = requiredOrFromEnvironment(options, 'accessKey', 'S3_ACCESS_KEY');
  options = requiredOrFromEnvironment(options, 'secretKey', 'S3_SECRET_KEY');
  options = requiredOrFromEnvironment(options, 'bucket', 'S3_BUCKET');
  options = fromEnvironmentOrDefault(options, 'bucketPrefix', 'S3_BUCKET_PREFIX', '');
  options = fromEnvironmentOrDefault(options, 'region', 'S3_REGION', DEFAULT_S3_REGION);
  options = fromEnvironmentOrDefault(options, 'directAccess', 'S3_DIRECT_ACCESS', false);
  options = fromEnvironmentOrDefault(options, 'baseUrl', 'S3_BASE_URL', null);
  return options;
}

// Creates an S3 session.
// Providing AWS access, secret keys and bucket are mandatory
// Region will use sane defaults if omitted
function S3AdapterTiny() {
  var options = optionsFromArguments(arguments);
  this._region = options.region;
  this._bucket = options.bucket;
  this._bucketPrefix = options.bucketPrefix;
  this._directAccess = options.directAccess;
  this._baseUrl = options.baseUrl;

  let s3Options = {
    accessKeyId: options.accessKey,
    secretAccessKey: options.secretKey,
    params: { Bucket: this._bucket },
    region: this._region
  };
  this._s3Client = new AWS.S3(s3Options);
  this._hasBucket = false;
}

S3AdapterTiny.prototype.createBucket = function() {
  var promise;
  if (this._hasBucket) {
    promise = Promise.resolve();
  } else {
    promise = new Promise((resolve, reject) => {
      this._s3Client.createBucket(() => {
        this._hasBucket = true;
        resolve();
      });
    });
  }
  return promise;
}

// for a given data buffer, return a compressed buffer via tinypng API
// Returns a promise containing the new data buffer
S3AdapterTiny.prototype.compressFile = function(data) {
  var promise = new Promise((resolve, reject) => {
       tinify.fromBuffer(data).toBuffer(function(err, resultData) {
          if (err) throw err;
          resolve(resultData);
       });
    });
  return promise;
}


// For a given config object, filename, and data, store a file in S3
// Returns a promise containing the S3 object creation response
S3AdapterTiny.prototype.createFile = function(filename, data, contentType) {
  
  let params = {
    Key: this._bucketPrefix + filename,
    Body: data
  };
  
  if (this._directAccess) {
    params.ACL = "public-read"
  }
  if (contentType) {
    params.ContentType = contentType;
  }
 

    
  return this.compressFile(data).then((resultData) => {
    params.Body = resultData;
    return this.createBucket().then(() => {
      return new Promise((resolve, reject) => {
        this._s3Client.upload(params, (err, data) => {
          if (err !== null) {
            return reject(err);
            console.log(err);
          }
          resolve(data);
        });
      });
    });
  });

 
 
}

S3AdapterTiny.prototype.deleteFile = function(filename) {
  return this.createBucket().then(() => {
    return new Promise((resolve, reject) => {
      let params = {
        Key: this._bucketPrefix + filename
      };
      this._s3Client.deleteObject(params, (err, data) =>{
        if(err !== null) {
          return reject(err);
        }
        resolve(data);
      });
    });
  });
}

// Search for and return a file if found by filename
// Returns a promise that succeeds with the buffer result from S3
S3AdapterTiny.prototype.getFileData = function(filename) {
  let params = {Key: this._bucketPrefix + filename};
  return this.createBucket().then(() => {
    return new Promise((resolve, reject) => {
      this._s3Client.getObject(params, (err, data) => {
        if (err !== null) {
          return reject(err);
        }
        // Something happend here...
        if (data && !data.Body) {
          return reject(data);
        }
        resolve(data.Body);
      });
    });
  });
}

// Generates and returns the location of a file stored in S3 for the given request and filename
// The location is the direct S3 link if the option is set, otherwise we serve the file through parse-server
S3AdapterTiny.prototype.getFileLocation = function(config, filename) {
  if (this._directAccess) {
    if (this._baseUrl) {
      return `${this._baseUrl}/${this._bucketPrefix + filename}`;
    } else {
      return `https://${this._bucket}.s3.amazonaws.com/${this._bucketPrefix + filename}`;
    }
  }
  return (config.mount + '/files/' + config.applicationId + '/' + encodeURIComponent(filename));
}

module.exports = S3AdapterTiny;
module.exports.default = S3AdapterTiny;
