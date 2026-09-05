<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-jsonl-process</code></h1>

<p align="center"><strong>面向进程型 Harness 协议的严格、有界 JSONL 传输。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-jsonl-process"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-jsonl-process/next?style=flat-square&amp;label=npm%20next" alt="npm next 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-jsonl-process"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-jsonl-process?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha 状态">
</p>

<!-- markdownlint-enable MD033 -->

这个包为非 JSON-RPC 的进程协议提供严格 JSONL
framing、有序入站迭代、串行写入、背压、超时和清理。Provider
Adapter 仍然负责启动进程、关联请求、解释消息、脱敏以及映射 Harapter 生命周期。

## 安装

```bash
pnpm add @harapter/transport-jsonl-process@next
```

## 快速开始

```ts
import { JsonlProcessTransport } from '@harapter/transport-jsonl-process';

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
