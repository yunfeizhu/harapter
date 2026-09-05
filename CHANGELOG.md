# Changelog

All notable changes to Harapter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/yunfeizhu/harapter/compare/harapter-v0.1.1...harapter-v0.2.0) (2026-09-04)


### Features

* **acp:** add stable ACP v1 protocol client ([#30](https://github.com/yunfeizhu/harapter/issues/30)) ([4895d4b](https://github.com/yunfeizhu/harapter/commit/4895d4b6ea46bc80bbd5a0eb584086dbff23fe30))
* **claude:** add Claude Agent SDK provider adapter ([#17](https://github.com/yunfeizhu/harapter/issues/17)) ([f88d021](https://github.com/yunfeizhu/harapter/commit/f88d02102a2c44341903b429370d4e1d3b6114e4))
* **codex:** add Codex harness adapter ([#10](https://github.com/yunfeizhu/harapter/issues/10)) ([273b933](https://github.com/yunfeizhu/harapter/commit/273b93383f12e02c3c7e981c147bdd1f5afabe41))
* **core:** establish portable Core foundation ([#3](https://github.com/yunfeizhu/harapter/issues/3)) ([69c6523](https://github.com/yunfeizhu/harapter/commit/69c652335322676d149761c0cc41c0d16124dc6e))
* **dsh:** add DeepSeek Harness provider adapter ([#26](https://github.com/yunfeizhu/harapter/issues/26)) ([8094227](https://github.com/yunfeizhu/harapter/commit/80942274dc6caab3617ef932e4528d4e420eff49))
* **examples:** add multi-provider reference client ([#40](https://github.com/yunfeizhu/harapter/issues/40)) ([5c5b6cb](https://github.com/yunfeizhu/harapter/commit/5c5b6cb9d6fbbbd24b216d37951820ec14e3eb2f))
* **examples:** add single-provider reference app ([#38](https://github.com/yunfeizhu/harapter/issues/38)) ([782e48a](https://github.com/yunfeizhu/harapter/commit/782e48a77f6ca90d2db38e014c2cea519cb32d3c))
* **hermes:** add Hermes Agent provider adapter ([#28](https://github.com/yunfeizhu/harapter/issues/28)) ([a084d1c](https://github.com/yunfeizhu/harapter/commit/a084d1ccb96dabc81c061ce2db9257ca607af187))
* **openclaw:** add ACP provider adapter ([#32](https://github.com/yunfeizhu/harapter/issues/32)) ([e2c3c68](https://github.com/yunfeizhu/harapter/commit/e2c3c68ed89fcc4dbcc204f09d445a45fd1200af))
* **opencode:** add OpenCode HTTP provider adapter ([#15](https://github.com/yunfeizhu/harapter/issues/15)) ([51ce23e](https://github.com/yunfeizhu/harapter/commit/51ce23e57ce964887e21d58de35f9ddb9de94724))
* **pi:** add Pi Agent RPC provider adapter ([#36](https://github.com/yunfeizhu/harapter/issues/36)) ([af40dc0](https://github.com/yunfeizhu/harapter/commit/af40dc0f430518082d464c2fd80af458dfc48138))
* **release:** prepare public package distribution ([#87](https://github.com/yunfeizhu/harapter/issues/87)) ([dcbb6fe](https://github.com/yunfeizhu/harapter/commit/dcbb6fe5e37c5e8e1aed4775647035168ade4a67))
* **transport:** add bounded bidirectional JSONL RPC ([#8](https://github.com/yunfeizhu/harapter/issues/8)) ([d5620f4](https://github.com/yunfeizhu/harapter/commit/d5620f45e3b155fcea88a6ef24ecfae1e2f5ac63))
* **transport:** add bounded HTTP and SSE transport ([#12](https://github.com/yunfeizhu/harapter/issues/12)) ([c9633d5](https://github.com/yunfeizhu/harapter/commit/c9633d54cd5991ec6ec33944eba931edcf45750d))
* **transport:** add bounded JSONL process transport ([#34](https://github.com/yunfeizhu/harapter/issues/34)) ([a105d10](https://github.com/yunfeizhu/harapter/commit/a105d108fa7fe6488e326862309d769f9f06580b))


### Bug Fixes

* bound provider live-canary probes and processes ([#55](https://github.com/yunfeizhu/harapter/issues/55)) ([8d8141d](https://github.com/yunfeizhu/harapter/commit/8d8141da190cf7baf1808a898fcd65641398e704))
* **claude:** keep provider runtime host-owned ([#19](https://github.com/yunfeizhu/harapter/issues/19)) ([7f8e28a](https://github.com/yunfeizhu/harapter/commit/7f8e28aae7175a9c1bc05dcdb4b3f9f45f091736))
* **codex:** accept client-originated runtime identity ([#57](https://github.com/yunfeizhu/harapter/issues/57)) ([e873a7a](https://github.com/yunfeizhu/harapter/commit/e873a7afce910cb07b5f7fac7d0430318acdca94))
* **codex:** order cancellation after turn start ([#83](https://github.com/yunfeizhu/harapter/issues/83)) ([f8e9924](https://github.com/yunfeizhu/harapter/commit/f8e99240a2eab81c38c95613459404d4fe080f7d))
* **codex:** preserve live canary failures ([#82](https://github.com/yunfeizhu/harapter/issues/82)) ([3a46c91](https://github.com/yunfeizhu/harapter/commit/3a46c91027050c04412d8fa5611f86dcf1da141c))
* **dsh:** refresh live lifecycle evidence ([#76](https://github.com/yunfeizhu/harapter/issues/76)) ([5abc183](https://github.com/yunfeizhu/harapter/commit/5abc18386936b57dd4a3a187193c4f5d73aef1ca))
* **dsh:** support current session events ([#49](https://github.com/yunfeizhu/harapter/issues/49)) ([f26bb00](https://github.com/yunfeizhu/harapter/commit/f26bb007f0f1503b6e2efb4552455b323bba7d96))
* **governance:** remove unrequested name prohibitions ([#95](https://github.com/yunfeizhu/harapter/issues/95)) ([c5b389f](https://github.com/yunfeizhu/harapter/commit/c5b389fa248244676e609dd7e6f121c3a3aed733))
* **hermes:** refresh live lifecycle evidence ([#78](https://github.com/yunfeizhu/harapter/issues/78)) ([f8c8d55](https://github.com/yunfeizhu/harapter/commit/f8c8d550952b2f6354a18f80c2d178fe47678532))
* **hermes:** report live-verified runtime evidence ([#70](https://github.com/yunfeizhu/harapter/issues/70)) ([12aff09](https://github.com/yunfeizhu/harapter/commit/12aff093888b863ece2b1c96751356d6368a179c))
* **openclaw:** refresh live lifecycle evidence ([#80](https://github.com/yunfeizhu/harapter/issues/80)) ([d43c5ee](https://github.com/yunfeizhu/harapter/commit/d43c5eeb0fb582855f9a7a7dcf89cf53debf2798))
* **openclaw:** report live-verified runtime evidence ([#72](https://github.com/yunfeizhu/harapter/issues/72)) ([b53c6d5](https://github.com/yunfeizhu/harapter/commit/b53c6d5173342c17f31b51b7fa7084b00a3782e6))
* **pi:** record live-verified lifecycle evidence ([#74](https://github.com/yunfeizhu/harapter/issues/74)) ([dd0e2a1](https://github.com/yunfeizhu/harapter/commit/dd0e2a17aa84e0a24a8ff03a5905dc34220f1f87))
* **release:** accept Release Please changelog formatting ([#93](https://github.com/yunfeizhu/harapter/issues/93)) ([979a58d](https://github.com/yunfeizhu/harapter/commit/979a58d61fe7cddf7f8961427605b6839088d483))
* **release:** align npm publication with generated tags ([#97](https://github.com/yunfeizhu/harapter/issues/97)) ([6a53d3b](https://github.com/yunfeizhu/harapter/commit/6a53d3bfd8b07850a69c2887a43e54e42db9d780))
* **release:** discover draft releases by ID ([#102](https://github.com/yunfeizhu/harapter/issues/102)) ([d0e80f3](https://github.com/yunfeizhu/harapter/commit/d0e80f3d7f4833f95cc57652a3c906b1a1eb5152))
* **release:** publish verified package assets ([#99](https://github.com/yunfeizhu/harapter/issues/99)) ([b4d64ad](https://github.com/yunfeizhu/harapter/commit/b4d64ad25a1f136985ec672efa130c52e65bf503))
* **release:** record removed Claude adapter in release notes ([#91](https://github.com/yunfeizhu/harapter/issues/91)) ([a61017a](https://github.com/yunfeizhu/harapter/commit/a61017a1adb1c0de0930a641ecb3fd19ab31e178))

## [0.1.1](https://github.com/yunfeizhu/harapter/compare/harapter-v0.1.0...harapter-v0.1.1) (2026-09-04)


### Bug Fixes

* **release:** align npm publication with generated tags ([#97](https://github.com/yunfeizhu/harapter/issues/97)) ([6a53d3b](https://github.com/yunfeizhu/harapter/commit/6a53d3bfd8b07850a69c2887a43e54e42db9d780))
* **release:** publish verified package assets ([#99](https://github.com/yunfeizhu/harapter/issues/99)) ([b4d64ad](https://github.com/yunfeizhu/harapter/commit/b4d64ad25a1f136985ec672efa130c52e65bf503))

## 0.1.0 (2026-09-04)


### Features

* **acp:** add stable ACP v1 protocol client ([#30](https://github.com/yunfeizhu/harapter/issues/30)) ([4895d4b](https://github.com/yunfeizhu/harapter/commit/4895d4b6ea46bc80bbd5a0eb584086dbff23fe30))
* **claude:** add Claude Agent SDK provider adapter ([#17](https://github.com/yunfeizhu/harapter/issues/17)) ([f88d021](https://github.com/yunfeizhu/harapter/commit/f88d02102a2c44341903b429370d4e1d3b6114e4))
* **codex:** add Codex harness adapter ([#10](https://github.com/yunfeizhu/harapter/issues/10)) ([273b933](https://github.com/yunfeizhu/harapter/commit/273b93383f12e02c3c7e981c147bdd1f5afabe41))
* **core:** establish portable Core foundation ([#3](https://github.com/yunfeizhu/harapter/issues/3)) ([69c6523](https://github.com/yunfeizhu/harapter/commit/69c652335322676d149761c0cc41c0d16124dc6e))
* **dsh:** add DeepSeek Harness provider adapter ([#26](https://github.com/yunfeizhu/harapter/issues/26)) ([8094227](https://github.com/yunfeizhu/harapter/commit/80942274dc6caab3617ef932e4528d4e420eff49))
* **examples:** add multi-provider reference client ([#40](https://github.com/yunfeizhu/harapter/issues/40)) ([5c5b6cb](https://github.com/yunfeizhu/harapter/commit/5c5b6cb9d6fbbbd24b216d37951820ec14e3eb2f))
* **examples:** add single-provider reference app ([#38](https://github.com/yunfeizhu/harapter/issues/38)) ([782e48a](https://github.com/yunfeizhu/harapter/commit/782e48a77f6ca90d2db38e014c2cea519cb32d3c))
* **hermes:** add Hermes Agent provider adapter ([#28](https://github.com/yunfeizhu/harapter/issues/28)) ([a084d1c](https://github.com/yunfeizhu/harapter/commit/a084d1ccb96dabc81c061ce2db9257ca607af187))
* **openclaw:** add ACP provider adapter ([#32](https://github.com/yunfeizhu/harapter/issues/32)) ([e2c3c68](https://github.com/yunfeizhu/harapter/commit/e2c3c68ed89fcc4dbcc204f09d445a45fd1200af))
* **opencode:** add OpenCode HTTP provider adapter ([#15](https://github.com/yunfeizhu/harapter/issues/15)) ([51ce23e](https://github.com/yunfeizhu/harapter/commit/51ce23e57ce964887e21d58de35f9ddb9de94724))
* **pi:** add Pi Agent RPC provider adapter ([#36](https://github.com/yunfeizhu/harapter/issues/36)) ([af40dc0](https://github.com/yunfeizhu/harapter/commit/af40dc0f430518082d464c2fd80af458dfc48138))
* **release:** prepare public package distribution ([#87](https://github.com/yunfeizhu/harapter/issues/87)) ([dcbb6fe](https://github.com/yunfeizhu/harapter/commit/dcbb6fe5e37c5e8e1aed4775647035168ade4a67))
* **transport:** add bounded bidirectional JSONL RPC ([#8](https://github.com/yunfeizhu/harapter/issues/8)) ([d5620f4](https://github.com/yunfeizhu/harapter/commit/d5620f45e3b155fcea88a6ef24ecfae1e2f5ac63))
* **transport:** add bounded HTTP and SSE transport ([#12](https://github.com/yunfeizhu/harapter/issues/12)) ([c9633d5](https://github.com/yunfeizhu/harapter/commit/c9633d54cd5991ec6ec33944eba931edcf45750d))
* **transport:** add bounded JSONL process transport ([#34](https://github.com/yunfeizhu/harapter/issues/34)) ([a105d10](https://github.com/yunfeizhu/harapter/commit/a105d108fa7fe6488e326862309d769f9f06580b))


### Bug Fixes

* bound provider live-canary probes and processes ([#55](https://github.com/yunfeizhu/harapter/issues/55)) ([8d8141d](https://github.com/yunfeizhu/harapter/commit/8d8141da190cf7baf1808a898fcd65641398e704))
* **claude:** keep provider runtime host-owned ([#19](https://github.com/yunfeizhu/harapter/issues/19)) ([7f8e28a](https://github.com/yunfeizhu/harapter/commit/7f8e28aae7175a9c1bc05dcdb4b3f9f45f091736))
* **codex:** accept client-originated runtime identity ([#57](https://github.com/yunfeizhu/harapter/issues/57)) ([e873a7a](https://github.com/yunfeizhu/harapter/commit/e873a7afce910cb07b5f7fac7d0430318acdca94))
* **codex:** order cancellation after turn start ([#83](https://github.com/yunfeizhu/harapter/issues/83)) ([f8e9924](https://github.com/yunfeizhu/harapter/commit/f8e99240a2eab81c38c95613459404d4fe080f7d))
* **codex:** preserve live canary failures ([#82](https://github.com/yunfeizhu/harapter/issues/82)) ([3a46c91](https://github.com/yunfeizhu/harapter/commit/3a46c91027050c04412d8fa5611f86dcf1da141c))
* **dsh:** refresh live lifecycle evidence ([#76](https://github.com/yunfeizhu/harapter/issues/76)) ([5abc183](https://github.com/yunfeizhu/harapter/commit/5abc18386936b57dd4a3a187193c4f5d73aef1ca))
* **dsh:** support current session events ([#49](https://github.com/yunfeizhu/harapter/issues/49)) ([f26bb00](https://github.com/yunfeizhu/harapter/commit/f26bb007f0f1503b6e2efb4552455b323bba7d96))
* **governance:** remove unrequested name prohibitions ([#95](https://github.com/yunfeizhu/harapter/issues/95)) ([c5b389f](https://github.com/yunfeizhu/harapter/commit/c5b389fa248244676e609dd7e6f121c3a3aed733))
* **hermes:** refresh live lifecycle evidence ([#78](https://github.com/yunfeizhu/harapter/issues/78)) ([f8c8d55](https://github.com/yunfeizhu/harapter/commit/f8c8d550952b2f6354a18f80c2d178fe47678532))
* **hermes:** report live-verified runtime evidence ([#70](https://github.com/yunfeizhu/harapter/issues/70)) ([12aff09](https://github.com/yunfeizhu/harapter/commit/12aff093888b863ece2b1c96751356d6368a179c))
* **openclaw:** refresh live lifecycle evidence ([#80](https://github.com/yunfeizhu/harapter/issues/80)) ([d43c5ee](https://github.com/yunfeizhu/harapter/commit/d43c5eeb0fb582855f9a7a7dcf89cf53debf2798))
* **openclaw:** report live-verified runtime evidence ([#72](https://github.com/yunfeizhu/harapter/issues/72)) ([b53c6d5](https://github.com/yunfeizhu/harapter/commit/b53c6d5173342c17f31b51b7fa7084b00a3782e6))
* **pi:** record live-verified lifecycle evidence ([#74](https://github.com/yunfeizhu/harapter/issues/74)) ([dd0e2a1](https://github.com/yunfeizhu/harapter/commit/dd0e2a17aa84e0a24a8ff03a5905dc34220f1f87))
* **release:** accept Release Please changelog formatting ([#93](https://github.com/yunfeizhu/harapter/issues/93)) ([979a58d](https://github.com/yunfeizhu/harapter/commit/979a58d61fe7cddf7f8961427605b6839088d483))
* **release:** record removed Claude adapter in release notes ([#91](https://github.com/yunfeizhu/harapter/issues/91)) ([a61017a](https://github.com/yunfeizhu/harapter/commit/a61017a1adb1c0de0930a641ecb3fd19ab31e178))

## [Unreleased]

### Added

* Initial open-source project foundation and migrated design documents.
