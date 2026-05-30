/** MRX Runtime 统一配置 */
export const CONFIG = {
  /** OpenClaw API base URL */
  apiBaseUrl: process.env.OPENCLAW_API_URL || "http://localhost:18789",
  /** 默认 MRX API 端口 */
  apiPort: parseInt(process.env.MRX_API_PORT || "3620"),
  /** 数据目录 */
  dataDir: process.env.MRX_DATA_DIR || "data",
  /** QMD 索引路径 */
  qmdIndexPath: process.env.MRX_QMD_PATH || "memory/mrx",
} as const;
