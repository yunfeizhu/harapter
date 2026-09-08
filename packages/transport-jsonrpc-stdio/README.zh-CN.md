<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-jsonrpc-stdio</code></h1>

<p align="center"><strong>在调用方拥有的 Node Stream 上提供有界双向 JSONL RPC。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-jsonrpc-stdio?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-jsonrpc-stdio?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

这个传输包面向通过 stdin/stdout 或等价 Node
Stream 交换一行一个 JSON 对象的 Provider
Adapter。它负责 framing、请求关联、有序入站消息、背压、超时和清理，但不解释 Provider 方法，也不生成 Harapter
Session、Run 或终态。

## 应用接入还是 Adapter 开发？

普通应用通常安装 `@harapter/core` 和 Provider
Adapter；实现或测试机器接口时才直接使用本包。下面是仅使用公开导入的完整离线案例，不启动真实 Runtime，也不构成 Provider 兼容性证据。

```sh
npm init -y
npm pkg set type=module
npm install @harapter/transport-jsonrpc-stdio
npm install -D typescript @types/node
```

将下面的完整代码保存为 `app.ts`。它只导入上面安装的 npm 包；Node.js
24 可以直接执行这份 TypeScript。

<!-- sdk-example: transport-jsonrpc-stdio.ts -->

```ts
import { PassThrough } from 'node:stream';
import { JsonRpcStdioTransport } from '@harapter/transport-jsonrpc-stdio';

// A deterministic in-memory peer; no Runtime or process is involved.
const readable = new PassThrough();
const writable = new PassThrough();
writable.on('data', (frame: Buffer) => {
  const request = JSON.parse(frame.toString('utf8')) as { id: number };
  readable.write(
    JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 'pong' }) + '\n',
  );
});
const transport = new JsonRpcStdioTransport({ readable, writable });
try {
  const reply = await transport.request('ping', {});
  if (reply !== 'pong') throw new Error('Unexpected synthetic response.');
  console.log({ responseReceived: true });
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
[全部公开包](https://www.npmjs.com/org/harapter)

## 安装

```bash
pnpm add @harapter/transport-jsonrpc-stdio
```

## 组合真实传输

```ts
import { JsonRpcStdioTransport } from '@harapter/transport-jsonrpc-stdio';

const transport = new JsonRpcStdioTransport({
  readable: controlledProcess.stdout,
  writable: controlledProcess.stdin,
  cleanup: () => stopControlledProcess(controlledProcess),
});

const incoming = (async () => {
  for await (const message of transport.incoming()) {
    await validateAndMapProviderMessage(message);
  }
})();

const initialized = await transport.request('initialize', {
  clientInfo: { name: 'harapter-provider', version: 'current' },
});

await validateInitializeResult(initialized);
await transport.close();
await incoming;
```

## 常见用法

- `request()` 发送请求并等待匹配响应；`notify()` 只写通知；
- `incoming()` 由唯一消费者处理远端请求与通知；
- 需要“终态响应之前的事件均已处理”时使用 `requestAfterInbound()`；
- Provider 已在别处权威解决远端请求时，用 `abandonInboundRequest()` 释放容量；
- `getRemoteError()` 是显式原始数据边界，返回值必须由 Adapter 校验和脱敏。

## 默认边界

- 单条消息、未读消息、待处理请求、入站请求和写操作均有有限上限；
- 默认请求等待 30 秒，所有 timer 值必须在 Node 可安全表示的范围内；
- 只接受单个 JSON 对象的 JSONL frame，不支持 batch array 或多行 frame；
- 可要求并发送精确的 JSON-RPC `"2.0"`，也可要求整数 numeric ID。

调用方拥有 Stream 和进程。`close()`
不会直接结束或销毁 Stream，只会关闭逻辑连接并最多调用一次可选
`cleanup`。`AbortSignal`
和 timeout 只终止本地等待，不会发送 Provider 取消，也不能证明远端工作已经停止。

## 错误与敏感数据

畸形 JSON、无效 UTF-8、超限消息、重复入站请求 ID 和提前 EOF 会 fail closed。
`JsonRpcTransportError` 不附带原始 frame、标识符或 Stream Error。远端 error、
`method` 和 `params` 仍是不可信 Provider 数据，Adapter 必须在记录或映射前脱敏。

该包不是进程管理器、Provider Adapter、重试层或通用 Agent
Loop。完整限制与所有配置项见[英文详细文档](./README.md)。

## 相关包

[全部包](../../README.zh-CN.md#npm-包导航)

| 包                                                                                                     | 文档                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [`@harapter/core`](https://www.npmjs.com/package/@harapter/core)                                       | [使用指南](../core/README.zh-CN.md)                    |
| [`@harapter/transport-jsonl-process`](https://www.npmjs.com/package/@harapter/transport-jsonl-process) | [使用指南](../transport-jsonl-process/README.zh-CN.md) |
| [`@harapter/transport-http-sse`](https://www.npmjs.com/package/@harapter/transport-http-sse)           | [使用指南](../transport-http-sse/README.zh-CN.md)      |
| [`@harapter/transport-acp`](https://www.npmjs.com/package/@harapter/transport-acp)                     | [使用指南](../transport-acp/README.zh-CN.md)           |
| [`@harapter/conformance`](https://www.npmjs.com/package/@harapter/conformance)                         | [使用指南](../conformance/README.zh-CN.md)             |
