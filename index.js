const uuidv4 = require('uuid/v4'),
    http = require('http'),
    httpProxy = require('http-proxy'),
    winston = require('winston'),
    winlog = require('winston-loggly-bulk');

const PORT = process.env.PORT || 5000;
const LOGGLY_TOKEN = process.env.LOGGLY_TOKEN || '';
const LIMIT = process.env.LIMIT || 3000;

let queue = [],
    lastRequestTime = new Date(),
    proxy = httpProxy.createProxyServer({changeOrigin: true});


async function wait(timeout) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve()
        }, timeout)
    })
}

async function rateLimit(rid) {
    while (queue.length > 1 && queue.indexOf(rid) !== 0) {
        await wait(500);
    }
    let diff = (new Date()).getTime() - lastRequestTime.getTime();
    if (diff < LIMIT) {
        await wait(LIMIT - diff);
    }
    return new Promise((resolve) => resolve());
}

if (LOGGLY_TOKEN) {
    winston.add(winston.transports.Loggly, {
        inputToken: LOGGLY_TOKEN,
        subdomain: "opsway",
        tags: ["Boodmo-Proxy-Zoho"],
        json: true,
        isBulk: true,
        bufferOptions: {
            size: 1000,
            retriesInMilliSeconds: 60 * 1000
        }
    });
}
winston.exitOnError = false;

proxy.on('proxyReq', (proxyReq, req, res, options) => {
    req.log.request = {
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.body
    };
    proxyReq.write(req.body);
});

proxy.on('proxyRes', (proxyRes, req, res) => {
    //console.log('RAW Response from the target', JSON.stringify(proxyRes.headers, true, 2));
    let body = new Buffer('');
    proxyRes.on('data', (data) => {
        body = Buffer.concat([body, data]);
    });
    proxyRes.on('end', () => {
        body = body.toString();
        req.log.response = {
            status: proxyRes.statusCode,
            headers: proxyRes.headers,
            body: body
        };
        //console.log("To Loggly:", req.log);
        winston.log('info',req.log);
    });
    queue.splice(queue.indexOf(req._rid), 1);
});


const app = async (req, res) => {
    let rid = uuidv4();
    try {
        queue.push(rid);
        req._rid = rid;
        req.log = {
            status: 'success',
            request: {},
            response: {},
            error: {}
        };
        //console.log('Begin request: ' + rid);
        let body = new Buffer('');
        req.on('data', (data) => {
            body = Buffer.concat([body, data]);
        });
        req.on('end', async () => {
            body = body.toString();
            req.body = body;

            await rateLimit(rid);
            lastRequestTime = new Date();
            let url = req.headers['x-proxy-to'];
            if (url == undefined) {
                res.statusCode = 503;
                req.log.status = 'error';
                req.log.error.msg = 'no-proxy';
                winston.log('error',req.log);
                queue.splice(queue.indexOf(rid), 1);
                res.end('Missed X-Proxy-To header');
                return;
            }
            console.log(url);
            proxy.web(req, res, {target: url}, (err) => {
                queue.splice(queue.indexOf(rid), 1);
                req.log.status = 'error';
                req.log.error.msg = err.Error;
                winston.log('error',req.log);
                res.writeHead(502);
                res.end("There was an error proxying your request");
            });
            //console.log('End request: ' + rid);
        });

    } catch (e) {
        res.statusCode = 500;
        res.end('Unknow error: ' + e.message);
        queue.splice(queue.indexOf(rid), 1);
    }
};

http.createServer(app).listen(PORT);
console.log("listening on port " + PORT);
