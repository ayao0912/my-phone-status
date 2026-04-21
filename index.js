import express from 'express';
import cors from 'cors';
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(express.json());
app.use(cors());

// 设置你的安全密码，防止别人乱发数据
const TOKEN = process.env.SECRET_TOKEN || "123456";

// 内存中保存手机数据
let phoneData =[];
let lastClearDate = new Date().getDate();

// 辅助功能：每天午夜清空数据
function checkAndClearData() {
    const today = new Date().getDate();
    if (today !== lastClearDate) {
        phoneData =[];
        lastClearDate = today;
    }
}

// 接收 iPhone 发来的数据的接口
app.post(`/${TOKEN}/phone-data`, (req, res) => {
    checkAndClearData();
    const data = req.body;
    phoneData.push({
        ...data,
        server_time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    });
    console.log("收到新数据：", data);
    res.json({ success: true, message: "数据已成功保存" });
});

// MCP AI 服务器配置
const mcpServer = new Server({ name: "PhoneStatus", version: "1.0.0" }, { capabilities: { tools: {} } });

// 告诉 AI 我们有什么工具
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools:[{
            name: "get_phone_status",
            description: "获取用户手机当天的状态记录，包括电量、是否充电、时间等。",
            inputSchema: { type: "object", properties: {} }
        }]
    };
});

// AI 调用工具时的操作
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "get_phone_status") {
        checkAndClearData();
        return {
            content:[{
                type: "text",
                text: JSON.stringify({
                    total_records: phoneData.length,
                    records: phoneData
                }, null, 2)
            }]
        };
    }
    throw new Error("工具不存在");
});

// MCP SSE 通信接口
const transports = new Map();

app.get(`/${TOKEN}/sse`, async (req, res) => {
    const sessionId = Date.now().toString();
    const transport = new SSEServerTransport(`/${TOKEN}/messages?sessionId=${sessionId}`, res);
    transports.set(sessionId, transport);
    await mcpServer.connect(transport);
    
    req.on('close', () => {
        transports.delete(sessionId);
    });
});

app.post(`/${TOKEN}/messages`, async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports.get(sessionId);
    if (transport) {
        await transport.handlePostMessage(req, res);
    } else {
        res.status(404).send("会话已断开");
    }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`手机状态服务器已启动，端口：${PORT}`);
});
