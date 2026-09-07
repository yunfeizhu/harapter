export {
  createDshProviderFactory,
  type DshNativeClient,
  type DshNativeRequestOptions,
  type DshNotificationObserver,
  type DshProfileOptions,
} from './adapter.js';
export {
  DSH_NOTIFICATION_EXTENSION,
  DSH_PROVIDER_ID,
  DSH_SESSION_COMPATIBILITY_REF,
  dshCompatibilityIdentity,
  type DshRawEvent,
} from './protocol.js';
export {
  DSH_GATEWAY_PROTOCOL,
  DSH_GATEWAY_SESSION_EXTENSION,
  type DshGatewayProfileOptions,
  type DshGatewaySessions,
  type DshGatewayNativeClient,
  type DshProviderFactoryOptions,
} from './gateway-types.js';
