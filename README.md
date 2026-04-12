# Hermes Dashboard

Hermes Dashboard 是一个基于 Next.js App Router 的本地控制台，用来查看和管理 Hermes 的会话、技能和记忆。

当前提供 3 个主页面：
- `/` 会话工作台
- `/skills` 技能管理
- `/memory` 记忆管理

## 功能概览

### 1. 会话工作台
- 查看 Hermes session 列表
- 根会话 / 子会话树状展示
- 支持搜索会话
- 支持删除会话，带二次确认
- 对 IM 来源会话显示来源标识（如微信、Telegram、Discord 等）
- 打开会话后默认滚动到最新消息
- 支持 3 种查看模式：
  - 对话
  - 完整链路
  - 原始 JSON
- 底部发送区支持：
  - 继续当前会话发送
  - 无选中会话时直接发送并创建新会话
  - 点击“新建”仅进入新会话草稿状态，不会立即创建后端 session
  - 在草稿状态输入消息并点击发送时，才会真实创建新会话

### 2. 技能管理
- 从 `~/.hermes/skills` 读取技能列表
- 搜索技能
- 编辑技能内容
- 保存回技能文件
- 查看差异预览
- 查看简要编辑说明

### 3. 记忆管理
- 读取 Hermes 持久记忆
- 搜索记忆
- 编辑并保存记忆
- 删除记忆
- 通过弹窗新增记忆
- 查看草稿预览与范围说明

## 目录结构

主要文件：
- `src/components/hermes-dashboard.tsx`：主界面实现
- `src/app/page.tsx`：会话页
- `src/app/skills/page.tsx`：技能页
- `src/app/memory/page.tsx`：记忆页
- `src/app/api/chat/route.ts`
- `src/app/api/sessions/route.ts`
- `src/app/api/sessions/[id]/route.ts`
- `src/app/api/skills/route.ts`
- `src/app/api/skills/[...skillPath]/route.ts`
- `src/app/api/memory/route.ts`
- `src/app/api/memory/[scope]/[index]/route.ts`
- `src/lib/hermes-sessions.ts`
- `src/lib/hermes-skills.ts`
- `src/lib/hermes-memory.ts`
- `src/lib/hermes-types.ts`

## 本地开发

启动开发服务器：

```bash
npm run dev
```

如需指定端口：

```bash
npm run dev -- --port 3210
```

打开：
- `http://localhost:3000`
- 或你指定的端口

## 构建与检查

```bash
npm run build
npm run lint
```

## 数据来源

Dashboard 主要读取以下 Hermes 本地数据：
- sessions：`~/.hermes/state.db`
- skills：`~/.hermes/skills`
- memory：Hermes 持久记忆文件

## 说明

这是一个本地运维 / 管理界面，重点在于：
- 紧凑工作台布局
- 多页面分区管理
- 尽量直接映射 Hermes 本地状态
- 尽量减少低价值装饰信息
