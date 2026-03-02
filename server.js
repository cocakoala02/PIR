const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8090;
const HOST = process.env.HOST || '127.0.0.1';

const DISEASE_DB = [
  {
    code: 'RD-ALD-001',
    name: 'X 连锁肾上腺脑白质营养不良',
    therapyId: 101,
    therapy: '洛伦佐油联合饮食干预；重症患者评估造血干细胞移植。'
  },
  {
    code: 'RD-SMA-002',
    name: '脊髓性肌萎缩症',
    therapyId: 102,
    therapy: '优先评估 SMN 增强治疗（如 nusinersen / risdiplam）与呼吸支持。'
  },
  {
    code: 'RD-ATTR-003',
    name: '遗传性转甲状腺素蛋白淀粉样变',
    therapyId: 103,
    therapy: 'TTR 稳定剂或 RNA 靶向治疗，并进行神经与心脏联合随访。'
  },
  {
    code: 'RD-GAU-004',
    name: '戈谢病',
    therapyId: 104,
    therapy: '酶替代治疗（ERT）或底物减少治疗（SRT），定期监测脾肝体积。'
  },
  {
    code: 'RD-PNH-005',
    name: '阵发性睡眠性血红蛋白尿',
    therapyId: 105,
    therapy: '补体抑制治疗并联合血栓风险管理和溶血指标跟踪。'
  },
  {
    code: 'RD-CF-006',
    name: '囊性纤维化',
    therapyId: 106,
    therapy: '根据基因分型评估 CFTR 调节剂，并进行多学科长期管理。'
  }
];

const THERAPY_MAP = Object.fromEntries(
  DISEASE_DB.map((row) => [String(row.therapyId), row.therapy])
);

const logs = [];

function addLog(message) {
  const entry = `${new Date().toISOString()} | ${message}`;
  logs.push(entry);
  if (logs.length > 80) {
    logs.shift();
  }
  console.log(entry);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function modPow(base, exp, mod) {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;

  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function handlePirQuery(payload, res) {
  try {
    const { publicKey, encryptedSelector } = payload;
    if (!publicKey || !publicKey.n || !publicKey.g || !Array.isArray(encryptedSelector)) {
      return sendJson(res, 400, { error: '缺少 publicKey 或 encryptedSelector。' });
    }

    if (encryptedSelector.length !== DISEASE_DB.length) {
      return sendJson(res, 400, {
        error: `密文索引长度必须为 ${DISEASE_DB.length}。`
      });
    }

    const n = BigInt(publicKey.n);
    const n2 = n * n;

    let encryptedAnswer = 1n;
    for (let i = 0; i < encryptedSelector.length; i += 1) {
      const c = BigInt(encryptedSelector[i]);
      const m = BigInt(DISEASE_DB[i].therapyId);
      encryptedAnswer = (encryptedAnswer * modPow(c, m, n2)) % n2;
    }

    const logMsg = `收到一组加密索引（长度 ${encryptedSelector.length}），无法识别具体疾病名称。`;
    addLog(logMsg);

    return sendJson(res, 200, {
      encryptedAnswer: encryptedAnswer.toString(),
      serverMessage: logMsg
    });
  } catch (error) {
    return sendJson(res, 400, { error: `PIR 计算失败：${error.message}` });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/catalog') {
    return sendJson(res, 200, {
      diseaseCodes: DISEASE_DB.map((row) => ({
        code: row.code,
        display: `${row.code} (${row.name})`
      })),
      treatments: THERAPY_MAP
    });
  }

  if (req.method === 'GET' && req.url === '/api/logs') {
    return sendJson(res, 200, { logs });
  }

  if (req.method === 'POST' && req.url === '/api/pir-query') {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      return handlePirQuery(payload, res);
    } catch (error) {
      return sendJson(res, 400, { error: `请求解析失败：${error.message}` });
    }
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('读取页面失败。');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`PIR demo server listening on http://${HOST}:${PORT}`);
  addLog('服务启动完成，等待加密查询请求。');
});
