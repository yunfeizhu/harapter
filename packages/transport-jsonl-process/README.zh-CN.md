<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/transports/jsonl-process</code></h1>

<p align="center"><strong>面向进程型 Harness 协议的严格、有界 JSONL 传输。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

本指南描述单个 `harapter`
SDK 内的模块。普通应用接入请先看[应用指南](../../packages/harapter/README.zh-CN.md)。单包入口的首次发布尚待完成，下面的安装命令适用于该版本发布后。

这个包为非 JSON-RPC 的进程协议提供严格 JSONL
framing、有序入站迭代、串行写入、背压、超时和清理。Provider
Adapter 仍然负责启动进程、关联请求、解释消息、脱敏以及映射 Harapter 生命周期。

## 应用接入还是 Adapter 开发？

普通应用通过 `harapter` 的 `createHarapter`
接入。实现或测试机器接口时才使用本 Transport 子路径。下面是仅使用公开导入的完整离线案例，不启动真实 Runtime，也不构成 Provider 兼容性证据。

```sh
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

将下面的完整代码保存为 `app.ts`。它只导入上面安装的 npm 包；Node.js
24 可以直接执行这份 TypeScript。

<!-- sdk-example: transport-jsonl-process.ts -->

```ts
import { PassThrough } from 'node:stream';
import { JsonlProcessTransport } from 'harapter/transports/jsonl-process';

const readable = new PassThrough();
const writable = new PassThrough();
writable.resume();
const transport = new JsonlProcessTransport({ readable, writable });
try {
  const incoming = transport.incoming()[Symbol.asyncIterator]();
  const next = incoming.next();
  readable.write('{"type":"ready"}\n');
  const message = await next;
  if (message.done) throw new Error('Missing synthetic message.');
  await transport.send({ type: 'ping' });
  console.log({ messageReceived: true, localWriteCompleted: true });
} finally {
  await transport.close();
  readable.destroy();
  writable.destroy();
}
```

```sh
node app.ts
```

真实集成时，将合成的流／Fetch 替换为下文所述的宿主进程或端点。启动协议、payload 校验、认证、脱敏和最终状态仍由使用它的 Adapter 负责。传输写入或 EOF 不等于 Run 成功或原生取消。

[完整应用、场景案例和错误处理](../../examples/sdk-application/README.zh-CN.md) ·
[全部公开包](https://www.npmjs.com/package/harapter)

## 安装

```bash
pnpm add harapter
```

## 组合真实传输

```ts
import { JsonlProcessTransport } from 'harapter/transports/jsonl-process';

const transport = new JsonlProcessTransport({
  readable: controlledProcess.stdout,
  writable: controlledProcess.stdin,
  cleanup: () => stopControlledProcess(controlledProcess),
});

const incoming = (async () => {
  for await (const message of transport.incoming()) {
    await validateAndMapProviderMessage(message);
  }
})();

await transport.send({ id: 'request-1', type: 'prompt', message: 'Hello' });
await transport.close();
await incoming;
```

## 行为边界

- 每条记录必须是一个 UTF-8 JSON 对象，以 LF 结尾；CRLF 也可接受；
- 空记录、array、primitive、无效 UTF-8、畸形 JSON 和截断的尾记录会关闭连接；
- 默认消息 1 MiB、未读消息 128、待写操作 128，写等待 30 秒；
- `send()` 成功只表示 Node 写回调完成，不表示 Provider 已接受或完成工作；
- 只有一个调用方可以消费 `incoming()`，停止消费会关闭逻辑连接。

调用方拥有 Stream。Transport 不会 spawn、kill、restart、end 或 destroy；可选
`cleanup` 由显式关闭或终态失败触发，最多执行一次。timeout 与 `AbortSignal`
仅控制本地写等待，不会发出 Provider 取消。

## 错误与安全

`JsonlTransportError`
使用固定、不含内容的错误消息，不保留 frame、标识符、路径、Stream
Error 或 Provider
Payload。入站对象仍是不可信数据，必须由 Adapter 在生成 Event、Error、Fixture 或日志前校验和脱敏。

该包不是进程管理器、请求响应协议、Provider Adapter、重试层或 Agent
Loop。完整配置和生命周期细节见[英文详细文档](./README.md)。

## 相关包

[全部包](../../README.zh-CN.md#npm-包导航)

| 包                                                                            | 文档                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`harapter`](https://www.npmjs.com/package/harapter)                          | [使用指南](../core/README.zh-CN.md)                    |
| [`harapter/transports/jsonrpc-stdio`](https://www.npmjs.com/package/harapter) | [使用指南](../transport-jsonrpc-stdio/README.zh-CN.md) |
| [`harapter/transports/http-sse`](https://www.npmjs.com/package/harapter)      | [使用指南](../transport-http-sse/README.zh-CN.md)      |
| [`harapter/transports/acp`](https://www.npmjs.com/package/harapter)           | [使用指南](../transport-acp/README.zh-CN.md)           |
| [`harapter/conformance`](https://www.npmjs.com/package/harapter)              | [使用指南](../conformance/README.zh-CN.md)             |
