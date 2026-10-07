# Photo Edition · 照片杂志

上传最多 20 张旅行、生活或情侣照片，在浏览器内编成可翻阅的中文杂志。

- Cropper.js 2.3.0：自由裁剪、比例裁剪、旋转；另提供轻量亮度和饱和度调整，原图可恢复。
- Flickr justified-layout 4.1.0：按照片宽高比排列缩略图和组图页；默认保留完整画面。
- Color Thief 3.5.0：从实际照片提取配色，自动生成纸色、背景和具有足够对比度的文字与点缀色。
- StPageFlip 2.0.7：真实纸张翻页计算、鼠标页角拖拽、触屏滑动；电脑双页、手机单页。

照片在本机处理，不上传服务器。草稿保存在浏览器 IndexedDB；清除站点数据会删除草稿。可下载包含照片、文字和所有依赖的单个 HTML 文件，离线打开后继续编辑。保存 PDF 使用浏览器打印，输出整本页面，较长的编辑正文会增加续页以保留全文。

正文只使用用户输入，按段落和标点分页；不生成未经提供的事实。标题、正文、图注可手动编辑。自动精简只取消明显相似照片的勾选，随时可以重新选择。

## 本地开发

需要 Node.js 20 或更新版本：

```sh
npm ci --ignore-scripts
npm run build
```

发布目录为 `dist`。生成的 `index.html` 内嵌全部脚本和样式，不依赖 CDN。GitHub Actions 构建并将该目录部署到 GitHub Pages。

`npm run check` 运行统一的手机、电脑、裁剪、编辑、草稿、离线下载及整本打印检查（本地验证使用系统 Microsoft Edge）。测试照片由程序生成，不包含用户照片。

四个上游项目均采用 MIT 许可证，完整许可证保存在 `dist/licenses`。锁定版本见 `package.json`、`package-lock.json` 和 `dist/dependencies.json`。
