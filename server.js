'use strict'

var http = require('http')
  , httpProxy = require('http-proxy')
  , url = require('url')
  ;

var proxy = httpProxy.createProxyServer({secure: false});

var token = process.env.ACCESS_TOKEN || '';

var config = {
  openshiftServer: 'https://openshift-master.summit2.paas.ninja:8443'
  ,openshiftServer2: 'http://google.ca'
};

var re = /^\/([a-z0-9\-]*)\/([a-z0-9\-]*)/;

var server = http.createServer(function(req, res) {
  if (req.url.indexOf('/api/v1beta3/namespaces/') !== 0) {
    var parsed = url.parse(req.url);
    var results = parsed.pathname.match(re);
    var apiUrl = '/api/v1beta3/namespaces/' + results[1] + '/pods/'+ results[2] +'/proxy/';
    var oldUrl = req.url.substring(results[0].length)
    req.url = apiUrl + oldUrl;
  };

  req.headers.authorization = 'Bearer ' + token;
  console.log(req.url);
  proxy.web(req, res, { target: config.openshiftServer });
});

console.log("listening on port 5050")
server.listen(5050);
