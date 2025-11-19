# 说明
* 这个项目是一个siyuan 笔记插件项目，插件提供的是将数据加载到siyuan 里的功能
* 以最小化单元代码做变更
* 推送到github 的需要限定文件夹，比如 cd plug-submit &&
* 不能在根目录推送到GitHub

# 环境情况

电脑是win 11，Bash 需要是Win 的命令。
在bash环境中应该使用cp而不是copy

杀进程是 Bash(taskkill //PID 20544 //F)

禁止运行 Bash(tasklist | findstr node)

# 开发流程
## 本地测试
复制插件文件到思源目录 cp -r siyuan-plug/dist/* "/c/Users/laizeyang/SiYuan/data/plugins/notehelper/"

# 修改代码

- 修改代码前需要先检查目录是否已经git commit 如果没有需要先commit 再进行修改
- 重写逻辑，让特殊情况消失，永远优于加 if 判断
- 兼容性是铁律，任何让用户程序崩掉的改动都是 bug
- 只解决真实存在的问题，不为“理论完美”浪费时间

# 参考资料
- 相似的obsidian 插件路径是 C:\Users\laizeyang\OneDrive\OWN\笔记同步助手\gate\obsidian\obsidian-plug