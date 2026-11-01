# tyut-cli

太原理工大学校园信息的只读命令行。登录自己的统一认证后，可以查看课表、逐门成绩、学分和 GPA、培养方案，也可以检索图书馆馆藏，并列出智慧校园中的业务应用。

它只读取页面和接口。不能选课、退课、转专业报名，也不能修改成绩或其他任何数据。

## 环境

- Node.js 20 或更高版本。不需要安装第三方包。
- 教务系统和图书馆只能在校园网内访问。校外查询这两处会返回 `campus_network_required`。
- 统一认证使用 `cas.tyut.edu.cn`。只有这个域名和 `one.tyut.edu.cn` 放宽证书校验，不会关闭全局 TLS 检查。

安装后可以直接使用 `tyut`：

```powershell
npm install -g tyut-cli
tyut --help
```

源码目录里也可以运行 `node src/cli.js --help`。

## 登录

```powershell
node src/cli.js auth login
```

学号和密码只在提示中输入。非交互环境读取 `TYUT_USERNAME` 和 `TYUT_PASSWORD`。不要把密码写进命令、脚本或参数；`--password` 会被直接拒绝。

程序不保存密码。密码不会进入日志或会话文件。会话只保存 Cookie，默认放在用户目录的 `.tyut-cli\session.json`，也可以用 `TYUT_HOME` 指定别的目录。`auth status` 只说明是否已经登录。`auth logout` 删除会话文件。

进入教务时访问 `http://192.168.200.7/login/NeuSoftCas`，之后只携带统一认证会话，不再提交第二套密码。用完后关闭留下密码环境变量的终端。

## 命令

- `tyut doctor`：检查 Node.js 版本、会话文件，以及统一认证、教务和图书馆能否连通。
- `tyut course today`：按北京时间显示今天的课。星期一为 1，星期日为 7。
- `tyut course list`：显示本学期课表。`--week 12` 只保留第 12 周；周次串第 n 周对应第 n-1 位为 `1`。
- `tyut grade summary`：显示要求学分、已修学分、平均成绩、加权成绩和排名。页面没有单独的 GPA 数字时，GPA 留空，程序不自行计算。
- `tyut grade list`：按学期列出课程成绩。
- `tyut plan status`：显示专业核心课程、专业选修课、学科交叉课程、实践环节、通识必修课、通识选修课、额外修读课程和其他类的应修学分、已修学分、已修门数。
- `tyut library search 书名`：不登录，公开检索馆藏。可以加 `--page 2`。
- `tyut library item marc_no`：读取公开详情里的索书号、条码号、馆藏地和书刊状态。
- `tyut apps`：列出业务应用的名称、地址和单点类型。

任何命令都可以加 `--json`。成功时输出：

```json
{
  "ok": true,
  "command": "course.today",
  "fetchedAt": "2026-11-02T12:00:00+08:00",
  "source": "academic",
  "data": {}
}
```

失败时只有这三项：

```json
{
  "ok": false,
  "command": "tyut",
  "error": {
    "code": "login_required",
    "message": "还没有登录。请先运行 tyut auth login。"
  }
}
```

错误码有五个：

- `campus_network_required`：教务或图书馆需要校园网。
- `login_required`：尚未登录，或统一认证没有通过。
- `session_expired`：登录已失效，需要重新登录。
- `upstream_unavailable`：统一认证或学校页面暂时不可用。
- `not_supported`：命令、周次或页码不被第一版接受。

成功退出码为 0，失败为 1。

## 请求边界

- 成绩和汇总只提交 `order=zxjxjhh desc,kch`。
- 培养方案的请求体为空，不提交学号。
- 课表沿用页面的当前周，并按页面方式读取理论课。
- 图书馆使用公开参数 `title`、`match_flag=forward`、`displaypg=20` 和 `page`。

## 明确不做

第一版不做这些事情：

- 选课、退课、转专业报名，以及其他任何提交或修改。
- 保存密码，或接受密码参数。
- 历年课表、借阅详情、空闲教室、考试地点和一卡通。
- AI skill。

## 测试

自动测试使用匿名夹具，不登录，也不访问校园网：

```powershell
npm test
```

连接校园网后可以手工核对。这些命令会读取你自己的账户，不要把输出发到公开场合：

```powershell
node src/cli.js doctor
node src/cli.js auth login
node src/cli.js auth status
node src/cli.js course today
node src/cli.js course list --week 1
node src/cli.js grade summary
node src/cli.js grade list
node src/cli.js plan status
node src/cli.js library search 数据结构
node src/cli.js apps
node src/cli.js auth logout
```

`library item` 使用检索结果里的 `marc_no`，这里不写真实值。
