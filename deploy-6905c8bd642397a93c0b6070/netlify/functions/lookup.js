const dns = require('dns').promises;
const whois = require('node-whois');
const axios = require('axios');

// 这是 Netlify Function 的主处理函数
exports.handler = async (event, context) => {
    // 1. 解析来自前端的请求
    // 我们只允许 POST 请求
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405, // 405 Method Not Allowed
            body: JSON.stringify({ error: '只允许 POST 请求' })
        };
    }

    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch (error) {
        return { statusCode: 400, body: JSON.stringify({ error: '无效的请求体 (JSON)' }) };
    }

    const { domain, type, ip } = payload;

    if (!domain && !ip) {
        return { statusCode: 400, body: JSON.stringify({ error: '缺少 "domain" 或 "ip" 参数' }) };
    }

    if (!type) {
        return { statusCode: 400, body: JSON.stringify({ error: '缺少 "type" 参数' }) };
    }

    // 2. 根据请求类型执行操作
    try {
        if (type === 'ip') {
            const ipData = await getIpInfo(ip);
            return {
                statusCode: 200,
                body: JSON.stringify({ data: ipData })
            };
        } else if (type === 'dns') {
            const dnsData = await getDnsInfo(domain);
            return {
                statusCode: 200,
                body: JSON.stringify({ data: dnsData })
            };
        } else if (type === 'whois') {
            const whoisData = await getWhoisInfo(domain);
            return {
                statusCode: 200,
                body: JSON.stringify({ data: whoisData })
            };
        } else if (type === 'domain') {
            const [dnsData, whoisData] = await Promise.all([
                getDnsInfo(domain),
                getWhoisInfo(domain)
            ]);
            
            const ipAddresses = [];
            if (dnsData.A.status === 'fulfilled' && dnsData.A.value.length > 0) {
                ipAddresses.push(...dnsData.A.value);
            }
            
            const ipGeoData = await Promise.all(
                ipAddresses.slice(0, 3).map(ip => getIpInfo(ip).catch(err => null))
            );
            
            return {
                statusCode: 200,
                body: JSON.stringify({ 
                    data: {
                        dns: dnsData,
                        whois: whoisData,
                        ipGeo: ipGeoData.filter(item => item !== null)
                    }
                })
            };
        } else {
            return { statusCode: 400, body: JSON.stringify({ error: '无效的 "type" 类型' }) };
        }
    } catch (error) {
        // 捕获查询过程中发生的任何错误
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || '服务器内部错误' })
        };
    }
};

/**
 * 异步函数：查询 DNS 信息
 * @param {string} domain 要查询的域名
 */
async function getDnsInfo(domain) {
    // 我们将同时查询多种类型的 DNS 记录
    // Promise.allSettled 会等待所有查询完成，无论成功还是失败
    const results = await Promise.allSettled([
        dns.resolve(domain, 'A'),
        dns.resolve(domain, 'AAAA'),
        dns.resolve(domain, 'MX'),
        dns.resolve(domain, 'TXT'),
        dns.resolve(domain, 'NS'),
    ]);

    // 将结果格式化为更易于前端处理的对象
    return {
        A: results[0],
        AAAA: results[1],
        MX: results[2],
        TXT: results[3],
        NS: results[4],
    };
}

/**
 * 异步函数：查询 Whois 信息
 * @param {string} domain 要查询的域名
 */
async function getWhoisInfo(domain) {
    return new Promise((resolve, reject) => {
        whois.lookup(domain, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

async function getIpInfo(ipAddress) {
    try {
        const response = await axios.get(`http://ip-api.com/json/${ipAddress}?fields=status,message,country,countryCode,region,regionName,city,lat,lon,isp,org,as,query`);
        
        if (response.data.status === 'fail') {
            throw new Error(response.data.message || 'IP查询失败');
        }
        
        return response.data;
    } catch (error) {
        throw new Error(`IP信息查询失败: ${error.message}`);
    }
}