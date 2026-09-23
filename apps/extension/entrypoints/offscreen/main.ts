/**
 * 离屏文档：长时间运行的工作都在这里执行
 * - 录制：采集标签页 / 屏幕 / 麦克风 → Web Audio 混音 → MediaRecorder → 分片写入 OPFS
 * - 会后处理：按 registries.pipeline 中登记的步骤依次执行（转写 → 纪要 → 关键帧 → 写入数据文件夹）
 *
 * 由后台通过 chrome.offscreen.createDocument 按需创建；具体实现见录制、处理管线相关子任务。
 */
export {}
