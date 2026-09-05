<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-jsonrpc-stdio</code></h1>

<p align="center"><strong>在调用方拥有的 Node Stream 上提供有界双向 JSONL RPC。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-jsonrpc-stdio/next?style=flat-square&amp;label=npm%20next" alt="npm next 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-jsonrpc-stdio?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha 状态">
</p>

<!-- markdownlint-enable MD033 -->

这个传输包面向通过 stdin/stdout 或等价 Node
Stream 交换一行一个 JSON 对象的 Provider
Adapter。它负责 framing、请求关联、有序入站消息、背压、超时和清理，但不解释 Provider 方法，也不生成 Harapter
Session、Run 或终态。

## 安装

```bash
pnpm add @harapter/transport-jsonrpc-stdio@next
```

## 快速开始

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
