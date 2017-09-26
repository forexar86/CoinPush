import {parse} from 'url';

const path = require('path');
const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const expressJwt = require('express-jwt');
const config = require('../../tradejs.config');
const app = express();
const morgan = require('morgan');
const helmet = require('helmet');
const request = require('request-promise');
const {raw, urlencoded, json} = require('body-parser');
const PATH_PUBLIC_PROD = path.join(__dirname, '../../client/dist');
const PATH_PUBLIC_DEV = path.join(__dirname, '../../client/dist');
const PATH_IMAGES_PROD = path.join(__dirname, '../../images');
const PATH_IMAGES_DEV = path.join(__dirname, '../../images');

/**
 * http
 */
const server = app.listen(config.server.gateway.port, () => {
	console.log('Gateway listening on port : ' + config.server.gateway.port);
});

/**
 * websocket
 */
server.on('upgrade', (req, socket, head) => {
	switch (parse(req.url).pathname) {
		case '/api/':
			proxy.ws(req, socket, head, {target: config.server.oldApi.apiUrl});
			break;
		case '/candles/':
			proxy.ws(req, socket, head, {target: config.server.cache.apiUrl});
			break;
	}
});

/**
 * proxy
 */
const proxy = global['proxyHandler'] = httpProxy.createProxyServer({});

proxy.on('proxyReq', function(proxyReq, req, res, options) {
	if (req.body) {
		let bodyData = JSON.stringify(req.body);
		// in case if content-type is application/x-www-form-urlencoded -> we need to change to application/json
		proxyReq.setHeader('Content-Type', 'application/json');
		proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
		// stream the content
		proxyReq.write(bodyData);
	}
});

proxy.on('error', function (err, req, res) {
	console.error(err);
});

/**
 *
 * body parsing (json) - needs this middleware for form-multipart (file-upload) to work
 */
const isMultipartRequest = function (req) {
	let contentTypeHeader = req.headers['content-type'];
	return contentTypeHeader && contentTypeHeader.indexOf('multipart') > -1;
};

const bodyParserJsonMiddleware = function () {
	return function (req, res, next) {
		if (isMultipartRequest(req)) {
			return next();
		}
		return json()(req, res, next);
	};
};

app.use(bodyParserJsonMiddleware());

app.use(morgan('dev'));
app.use(helmet());
// app.use(urlencoded({extended: false}));

app.use(express.static(process.env.NODE_ENV === 'production' ? PATH_PUBLIC_PROD : PATH_PUBLIC_DEV));
app.use(express.static(process.env.NODE_ENV === 'production' ? PATH_IMAGES_PROD : PATH_IMAGES_DEV));

app.use((req, res, next) => {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Headers', 'Authorization, Origin, X-Requested-With, Content-Type, Accept');
	next();
});

// use JWT auth to secure the api, the token can be passed in the authorization header or query string
app.use(expressJwt({
	secret: config.token.secret,
	getToken(req) {
		if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer')
			return req.headers.authorization.split(' ')[1];

		return null;
	}
}).unless(function (req) {
	return (
		(/\.(gif|jpg|jpeg|tiff|png)$/i).test(req.originalUrl) ||
		req.originalUrl === '/' ||
		req.originalUrl.indexOf('/sounds/') > -1 ||
		(req.originalUrl === '/authenticate' && (req.method === 'POST' || req.method === 'OPTIONS')) ||
		(req.originalUrl === '/user' && (req.method === 'POST' || req.method === 'OPTIONS'))
	);
}));

/**
 * error - unauthorized
 */
app.use((err, req, res, next) => {
	console.log('ERRORO NAME: ', err.name);

	if (err.name === 'UnauthorizedError')
		return res.status(401).send('invalid token...');

	next();
});

/**
 * set client user id for upcoming (proxy) requests
 */
app.use((req, res, next) => {
	if (req.user)
		req.user.id = req.headers._id = req.user.sub;
	else
		req.user = {};

	next();
});

/**
 * root (index.html)
 */
app.get('/', (req, res) => proxy.web(req, res, {target: config.server.fe.apiUrl}));

/**
 * authenticate
 */
app.use('/authenticate', require('./api/authenticate.api'));

/**
 * upload
 */
app.use('/upload', require('./api/upload.api'));

/**
 * image
 */
app.get('/images/*', (req, res) => proxy.web(req, res, {target: config.server.fe.apiUrl}));

/**
 * user
 */
app.use('/user', require('./api/user.api'));
app.use('/user-overview', require('./api/user.overview.api'));

/**
 * channel
 */
app.use('/channel', require('./api/channel.api'));

/**
 * order
 */
app.use('/order', require('./api/order.api'));

/**
 * SEARCH
 */
app.get('/search', (req, res, next) => {
	next();
});

app.get('/search/:text', async (req, res) => {
	const text = req.params.text;
	const returnObj = {
		users: [],
		channels: [],
		symbols: []
	};

	try {
		const userRequest = request({
			uri: 'http://localhost:3002/social/search/' + text,
			headers: {
				'_id': req.user.sub
			},
			json: false
		});

		const results = await Promise.all([userRequest]);
		returnObj.users = results[0];
		returnObj.channels = results[1];
		returnObj.symbols = results[2];
	} catch (error) {
		console.error(error);

		res.status(500).send(error);
		return;
	}

	res.send(returnObj);
});

function errorHandler (err, req, res, next) {
	if (res.headersSent) {
		return next(err)
	}
	res.status(500).send({ error: err });
}

app.use(errorHandler);