// rfc3161.mjs —— 时间戳请求编码/响应解析的离线测试（不联网）
import { buildRequest, parseResponse, readTlv, tlv } from '../lib/rfc3161.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const digestHex = 'a'.repeat(64);
const req = buildRequest(digestHex);
check('请求是 SEQUENCE', req[0] === 0x30);
const outer = readTlv(req, 0);
check('长度字段自洽', outer.end === req.length, `${outer.end} vs ${req.length}`);
const version = readTlv(outer.content, 0);
check('version=1', version.tag === 0x02 && version.content[0] === 1);
const imprint = readTlv(outer.content, version.end);
check('messageImprint 是 SEQUENCE', imprint.tag === 0x30);
const algo = readTlv(imprint.content, 0);
check('algorithm 是 SEQUENCE', algo.tag === 0x30);
const oid = readTlv(algo.content, 0);
check('OID 是 sha256（2.16.840.1.101.3.4.2.1）', oid.tag === 0x06 && oid.content.toString('hex') === '608648016503040201', oid.content.toString('hex'));
const hashed = readTlv(imprint.content, algo.end);
check('hashedMessage 是 32 字节 OCTET STRING', hashed.tag === 0x04 && hashed.content.length === 32);
check('digest 内容正确', hashed.content.toString('hex') === digestHex);

let threw = false;
try { buildRequest('abc'); } catch { threw = true; }
check('非 32 字节摘要会报错', threw === true);

// 合成一个 granted 响应：SEQUENCE { SEQUENCE { INTEGER 0 }, [token bytes] }
const statusInfo = tlv(0x30, tlv(0x02, Buffer.from([0])));
const fakeToken = tlv(0x30, Buffer.from([1, 2, 3]));
const resp = tlv(0x30, Buffer.concat([statusInfo, fakeToken]));
const parsed = parseResponse(resp);
check('解析出 status=0（granted）', parsed.status === 0 && parsed.granted === true);
check('识别出带 token', parsed.hasToken === true);

const rejected = parseResponse(tlv(0x30, tlv(0x30, tlv(0x02, Buffer.from([2])))));
check('status=2 视为拒绝', rejected.status === 2 && rejected.granted === false);

let bad = false;
try { parseResponse(Buffer.from([0x31, 0x00])); } catch { bad = true; }
check('非 SEQUENCE 会抛错', bad === true);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
