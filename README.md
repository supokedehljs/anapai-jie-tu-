# SnapAI 极简截图工具

## 已实现功能

1. 托盘图标右键菜单
   - 区域截图
   - 设置（占位）
2. 区域截图后显示置顶窗口（始终在最前）
3. 全部通过可见按钮操作，不使用任何快捷键
4. 置顶图片右键菜单支持 RunningHub 图生图调用
   - 上传当前贴图到 RunningHub
   - 切换不同工作流 json（可放多个）

## 运行方式

```bash
npm install
npm start
```

## 操作说明

- 右下角托盘图标右键 -> 点击 `区域截图`
- 鼠标拖拽选择区域 -> 点击 `完成截图`
- 截图会进入置顶窗口，可点击：
  - `保存`
  - `重新截图`
  - `关闭`
- 在置顶图上右键，可打开 RunningHub 菜单：
  - `上传到 RunningHub 生图`
  - `选择工作流`（多个 json 可切换）
  - `打开 RunningHub 配置`
  - `打开工作流目录`

## RunningHub 配置

1. 编辑 `runninghub.config.json`，填入 `apiKey`
2. 把你的多个工作流 json 放到 `runninghub-workflows/`
3. 工作流 json 中，将图像输入字段的值写成占位符 `{{RUNNINGHUB_IMAGE_URL}}`
4. 右键置顶图 -> `选择工作流` 切换目标工作流
5. 再点击 `上传到 RunningHub 生图`

示例见：`runninghub-workflows/example-img2img.json`

RunningHub 文档：<https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287334>
