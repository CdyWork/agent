# 山东大学求职助手网页

一个山东大学求职助手页面，包含 AI 咨询、近期求职动态和官方渠道入口。

## 启动

PowerShell:

```powershell
$env:AGENT_API_KEY="你的 Agent API Key"
npm start
```

打开 `http://localhost:5173`。

可选环境变量：

- `PORT`: 本地端口，默认 `5173`
- `AGENT_API_URL`: Agent 调用地址
- `AGENT_CARD_URL`: Agent 元数据地址

## 文件

- `server.js`: 静态站点服务与 Agent 代理
- `public/index.html`: 页面结构
- `public/styles.css`: 页面样式
- `public/app.js`: 聊天、新闻和链接交互
