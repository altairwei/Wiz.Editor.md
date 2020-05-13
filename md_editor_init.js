/**
 * Create
 * @param {*} objApp C++ API WizExplorerApp
 * @param {*} objPlugin C++ API JSPluginSpec
 * @param {*} config EditorMdConfig object.
 * @param {*} docSaver DocumentSaver object.
 */
function EditorMdApp(objApp, objPlugin, config, docSaver) {
    this.objApp = objApp;
    this.objCommon = objApp.CommonUI;
    //TODO: 实现这个 API
    this.pluginPath = objPlugin.PluginPath;
    this.objDocument = null;
    this.docTempPath = null;

    this.editor = null;
    this.docSaver = docSaver;
    this.modified = false;
    this.plainPasteMode = false;  
    this.config = config;
    this.wantSaveKey = false;
    this.wantSaveTime = null;

    // Bind this to methods
    this.saveDocument = this.saveDocument.bind(this);
    this.exit = this.exit.bind(this);
}

EditorMdApp.prototype.init = async function() {
    this.objDocument = await objApp.Window.CurrentDocument();

    // Set tab text to document title.
    document.title = this.objDocument.Title;

    // Extract document content
    const tempPath = await this.extractDocumentToFolder();

    // Get document
    const mdSourceCode = await this.loadDocumentHtml(tempPath + "index.html");
    const opt = this.config.getOptionSettings();
    this.setupEditor(opt, mdSourceCode);
}

EditorMdApp.prototype.exit = function() {
    // Remove C++ object 'objDocument'
    if (this.objDocument)
        this.objDocument.delateLater();
}

EditorMdApp.prototype.extractDocumentToFolder = async function() {
    let tempPath = await this.objCommon.GetSpecialFolder("TemporaryFolder");
    tempPath += "editor_md_temp/"; /** Temporary folder for Wiz.Editor.md */
    await this.objCommon.CreateDirectory(tempPath);
    tempPath += this.objDocument.GUID + "/"; /** Temporary folder for current document */
    await this.objCommon.CreateDirectory(tempPath);
    await this.objCommon.CreateDirectory(tempPath + "index_files/");
    await this.objDocument.SaveToFolder(tempPath);
    this.docTempPath = tempPath;
    
    return tempPath;
}

/** Load document html content from local file. */
EditorMdApp.prototype.loadDocumentHtml = async function(htmlFileName) {
    let code = "";

    // Load html body
    let content = await this.objCommon.LoadTextFromFile(htmlFileName);
    content = content.match(/<body[^>]*>[\s\S]*<\/body>/gi)[0];

    const tempBody = document.body.innerHTML;
    document.body.innerHTML = content;

    const imgs = document.body.getElementsByTagName('img');
    if (imgs.length) {
        for (let i = imgs.length - 1; i >= 0; i--) {
            const pi = imgs[i];
            if (pi && pi.parentNode.getAttribute("name") != "markdownimage") {
                const imgmd = document.createTextNode("![](" + pi.getAttribute("src") + ")");
                $(pi).replaceWith(imgmd);
            }
        }
    }

    const links = document.body.getElementsByTagName('a');
    if (links.length) {
        for (let i = links.length - 1; i >= 0; i--) {
            const pi = links[i];
            if (pi && pi.getAttribute("href").indexOf("wiz://open_") != -1) {
                const linkmd = document.createTextNode("[" + pi.textContent + "](" + pi.getAttribute("href") + ")");
                $(pi).replaceWith(linkmd);
            }
        }
    }

    // Get pure markdown content from html
    content = document.body.innerText;
    document.body.innerHTML = tempBody;
    code = content;

    /*code = objDocument.GetText(0);*/
    code = code.replace(/\u00a0/g, ' ');

    // 如果用原生编辑器保存过图片，会被替换成错的图片路径
    //var imgErrorPath = guid + "_128_files/";
    //code = code.replace(new RegExp(imgErrorPath, "g"), filesDirName);

    return code;
}

EditorMdApp.prototype.captureScreenImage = async function() {
    const filename = await this.objCommon.CaptureScreen(0);
    if (await this.objCommon.PathFileExists(filename)) {
        this.editor.insertValue("![](" + await this.docSaver.getSavedLocalImage(filename) + ")");
    };
}

/** 剪贴板图片 */
EditorMdApp.prototype.clipboardToImage = async function() {
    const filename = await this.objCommon.ClipboardToImage(this.objApp.Window.HWND, "");
    if (await this.objCommon.PathFileExists(filename)) {
        this.editor.insertValue("![](" + await this.docSaver.getSavedLocalImage(filename) + ")");
    }
};

/** 显示纯文本粘贴模式 */
EditorMdApp.prototype.showPlainPasteMode = function() {
    if (this.plainPasteMode) {
        $(".fa-clipboard").addClass("menu-selected");
    } else{
        $(".fa-clipboard").removeClass("menu-selected");
    };
};

/** 剪贴板解析HTML转换到Markdown */
EditorMdApp.prototype.clipboardHTMLToMd = function(htmlText) {
    if (htmlText != "") {
        const referencelinkRegEx = /reference-link/;
        this.editor.insertValue(toMarkdown(htmlText, {
            gfm: true,
            converters:[
            {
                filter: 'div',
                replacement: function(content) {
                    return content + '\n';
                }
            },
            {
                filter: 'span',
                replacement: function(content) {
                    return content;
                }
            },
            {
                filter: function (node) {
                    return (node.nodeName === 'A' && referencelinkRegEx.test(node.className));
                },
                replacement: function(content) {
                    return "";
                }
            }]})
        );
        return true;
    }
    return false;
};

/** 解析参数 */
EditorMdApp.prototype.getQueryString = function(name, hrefValue) {
    if (hrefValue.indexOf("?") == -1 || hrefValue.indexOf(name + '=') == -1) {
        return '';
    }
    var queryString = hrefValue.substring(hrefValue.indexOf("?") + 1);

    var parameters = queryString.split("&");

    var pos, paraName, paraValue;
    for (var i = 0; i < parameters.length; i++) {
        pos = parameters[i].indexOf('=');
        if (pos == -1) { continue; }

        paraName = parameters[i].substring(0, pos);
        paraValue = parameters[i].substring(pos + 1);

        if (paraName == name) {
            return unescape(paraValue.replace(/\+/g, " "));
        }
    }
    return '';
};

/** 打开新文档 */
EditorMdApp.prototype.openOtherDocument = async function(hrefValue) {
    const guid = this.getQueryString("guid", hrefValue);
    if (guid == "") {
        return true;
    }

    const kbGUID = this.getQueryString("kbguid", hrefValue);
    let newDatabase = null

    if (kbGUID == "" || kbGUID == null) {
        newDatabase = objApp.Database;
    }
    else {
        newDatabase = await objApp.GetGroupDatabase(kbGUID);
    }
    const isAttachment = hrefValue.indexOf("wiz://open_attachment") != -1;

    try {
        if (isAttachment) {
            const newAttachment = await newDatabase.AttachmentFromGUID(guid);
            await this.objApp.Window.ViewAttachment(newAttachment);
        }
        else
        {
            var newDocument = await newDatabase.DocumentFromGUID(guid);
            await objApp.Window.ViewDocument(newDocument, true);
        }
        return false;
    }
    catch (err) {
    }

    return true;
};

/** 用默认浏览器打开链接 */
EditorMdApp.prototype.openHrefInBrowser = async function(hrefValue) {
    const opt = this.config.getOptionSettings();
    if (opt.HrefInBrowser == "1") {
        try {
            await this.objCommon.OpenUrl(hrefValue);
            return false;
        }
        catch (err) {
        }
    }

    return true;
};

/** 配置编辑器功能 */
EditorMdApp.prototype.setupEditor = function(optionSettings, markdownSourceCode) {
    const self = this;
    this.editor = editormd("test-editormd", {
        theme           : optionSettings.EditToolbarTheme,        // 工具栏区域主题样式，见editormd.themes定义，夜间模式dark
        editorTheme     : optionSettings.EditEditorTheme,         // 编辑器区域主题样式，见editormd.editorThemes定义，夜间模式pastel-on-dark
        previewTheme    : optionSettings.EditPreviewTheme,        // 预览区区域主题样式，见editormd.previewThemes定义，夜间模式dark
        value           : markdownSourceCode,
        path            : self.pluginPath + "Editor.md/lib/",
        htmlDecode      : "style,script,iframe",  // 开启HTML标签解析，为了安全性，默认不开启
        codeFold        : true,              // 代码折叠，默认关闭
        tex             : true,              // 开启科学公式TeX语言支持，默认关闭
        flowChart       : true,              // 开启流程图支持，默认关闭
        sequenceDiagram : true,              // 开启时序/序列图支持，默认关闭
        toc             : true,              // [TOC]自动生成目录，默认开启
        tocm            : false,             // [TOCM]自动生成下拉菜单的目录，默认关闭
        tocTitle        : "",                // 下拉菜单的目录的标题
        tocDropdown     : false,             // [TOC]自动生成下拉菜单的目录，默认关闭
        emoji           : optionSettings.EmojiSupport == "1" ? true : false,              // Emoji表情，默认关闭
        taskList        : true,              // Task lists，默认关闭
        disabledKeyMaps : [
            "F9", "F10", "F11"               // 禁用切换全屏状态，因为为知已经支持
        ],
        keymapMode      : optionSettings.KeymapMode,              // 键盘映射模式
        toolbarIcons : function() {
            return self.getEditToolbarButton(optionSettings.EditToolbarButton);
        },
        toolbarIconsClass : {
            saveIcon : "fa-floppy-o",  // 指定一个FontAawsome的图标类
            captureIcon : "fa-scissors",
            plainPasteIcon : "fa-clipboard",
            optionsIcon : "fa-gear",
            outlineIcon : "fa-list",
            counterIcon : "fa-th-large",
        },
        toolbarHandlers : {
            saveIcon : async function() {
                // Save image
                let doc = self.editor.getValue();
                const arrResult = await self.docSaver.dealImgDoc(doc);
                if (arrResult[0] != doc) {
                    const cursor = self.editor.getCursor();
                    self.editor.setMarkdown(arrResult[0]);
                    self.editor.setCursor(cursor);
                    doc = arrResult[0];
                };
                // Save document
                await self.docSaver.saveDocument(self.objDocument, doc);
                self.modified = false;
            },
            captureIcon : async function() {
                await self.captureScreenImage();
            },
            plainPasteIcon : function() {
                plainPasteMode = !plainPasteMode;
                self.showPlainPasteMode();
            },
            optionsIcon : function() {
                this.executePlugin("optionsDialog", "options-dialog/options-dialog");
            },
            outlineIcon : function() {
                this.executePlugin("outlineDialog", "outline-dialog/outline-dialog");
            },
            counterIcon : function() {
                this.executePlugin("counterDialog", "counter-dialog/counter-dialog");
            },
        },
        lang : {
            description : "为知笔记Markdown编辑器，基于 Editor.md 构建。",
            toolbar : {
                saveIcon : "保存 (Ctrl+S)",
                captureIcon : "截取屏幕",
                plainPasteIcon : "纯文本粘贴模式",
                optionsIcon : "选项",
                outlineIcon : "内容目录",
                counterIcon : "文章信息",
            }
        },
        onload : function() {
            var keyMap = {
                "Ctrl-F9": function(cm) {
                    $.proxy(wizEditor.toolbarHandlers["watch"], wizEditor)();
                },
                "Ctrl-F10": function(cm) {
                    $.proxy(wizEditor.toolbarHandlers["preview"], wizEditor)();
                },
                "F1": function(cm) {
                    self.editor.cm.execCommand("defaultTab");
                },
                "Ctrl-Alt-F": function(cm) {
                    self.editor.cm.execCommand("find");
                },
                "Ctrl": function(cm) {
                    // 可能按了保存快捷键，记录
                    self.wantSaveKey = true;
                    self.wantSaveTime = new Date();
                }
            };
            this.addKeyMap(keyMap);
            self.showPlainPasteMode();

            // 监听文本变化事件
            this.cm.on("change", function(_cm, changeObj) {
                self.modified = true;
            });

            // 监听粘贴事件
            this.cm.on("paste", function (_cm, e) {
                const clipboardData = event.clipboardData || window.clipboardData;
                if (clipboardData) {
                    if (clipboardData.types == "Files") {
                        self.clipboardToImage();
                    }
                    else if ($.inArray("text/html", clipboardData.types) != -1) {
                        if (!self.plainPasteMode && self.clipboardHTMLToMd(clipboardData.getData("text/html"))) {
                            e.preventDefault();
                        }
                    }
                    else {
                        //类型为"text/plain"，快捷键Ctrl+Shift+V
                    }
                }
            });

            // 绑定Ctrl-S快捷键和Vim的w命令保存
            CodeMirror.commands.save = self.saveDocument;

            var isWebPage = false;
            if (isWebPage)
            {
                $.get('Editor.md/examples/test.md', function(md){
                    self.editor.setMarkdown(md);
                    self.editor.save();
                });
            }
        },
        onimageUploadButton : async function() {
            const filename = await self.objCommon.SelectWindowsFile(true, "Image Files(*.png;*.jpg;*.gif;*.bmp)|*.png;*.jpg;*.gif;*.bmp|");
            return await self.docSaver.getSavedLocalImage(filename);
        },
        onloadLocalFile : async function(filename, fun) {
            fun(await self.objCommon.LoadTextFromFile(filename));
        },
        onloadLocalJsonFile : async function(filename, fun) {
            fun($.parseJSON(await self.objCommon.LoadTextFromFile(filename)));
        },
        onsaveOptions : function(optionsValue) {
            self.handleSaveOptions(optionsValue);
        },
        ongetOptions : async function() {
            return await self.getOptionSettings();
        },
        ongetObjDocument : function() {
            return self.objDocument;
        },
        ongetObjCommon : function() {
            return self.objCommon;
        },
        onclickHyperlink : function(hrefValue) {
            return self.openOtherDocument(hrefValue) && self.openHrefInBrowser(hrefValue);
        }
    });
}

/** 获得工具栏按钮 */
EditorMdApp.prototype.getEditToolbarButton = function(style) {
    if (style == "lite") {
        return [
            "saveIcon", "|",
            "bold", "italic", "|",
            "link", "quote", "code", "image", "|",
            "list-ol", "list-ul", "h1", "hr", "|",
            "undo", "redo", "||",
            "outlineIcon", "counterIcon", "optionsIcon", "help", "info"
        ];
    } else{
        return [
            "saveIcon", "|",
            "undo", "redo", "|",
            "bold", "del", "italic", "quote", "ucwords", "uppercase", "lowercase", "|",
            "h1", "h2", "h3", "|",
            "list-ul", "list-ol", "hr", "|",
            "plainPasteIcon", "link", "reference-link", "image", "captureIcon", "code", "preformatted-text", "code-block", "table", "datetime", "emoji", "html-entities", "pagebreak", "|",
            "goto-line", "watch", "preview", "clear", "search", "||",
            "outlineIcon", "counterIcon", "optionsIcon", "help", "info"
        ];
    };
};

EditorMdApp.prototype.handleSaveOptions = async function(optionsValue) {
    const oldOptionSettings = this.config.getOptionSettings();

    if (oldOptionSettings.EditToolbarButton != optionsValue.EditToolbarButton) {
        const doc = this.editor.getValue();
        this.editor.config("toolbarIcons", this.getEditToolbarButton(optionsValue.EditToolbarButton));
        this.editor.setValue(doc);
    }
    if (oldOptionSettings.EditToolbarTheme != optionsValue.EditToolbarTheme) {
        this.editor.setTheme(optionsValue.EditToolbarTheme);
    }
    if (oldOptionSettings.EditEditorTheme != optionsValue.EditEditorTheme) {
        this.editor.setEditorTheme(optionsValue.EditEditorTheme);
    }
    if (oldOptionSettings.EditPreviewTheme != optionsValue.EditPreviewTheme) {
        this.editor.setPreviewTheme(optionsValue.EditPreviewTheme);
    }
    if (oldOptionSettings.EmojiSupport != optionsValue.EmojiSupport) {
        const doc = wizEditor.getValue();
        this.editor.config("emoji", optionsValue.EmojiSupport == "1" ? true : false);
        this.editor.setValue(doc);
    }
    if (oldOptionSettings.KeymapMode != optionsValue.KeymapMode) {
        this.editor.setKeymapMode(optionsValue.KeymapMode);
    }

    this.config.setOptionSettings(optionsValue);
}

/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////

function EditorMdConfig(objApp) {
    this.objApp = objApp;
    this.objCommon = objApp.CommonUI;
    //TODO: get plugin path from JSPluginSpec
    this.pluginFullPath = null;
    
    this.__optionSettings = null;
}

/** 获得配置值 */
EditorMdConfig.prototype.getConfigValue = async function(key, defaultValue) {
    let value = null;
    if (this.objCommon == null) {
        value = localStorage.getItem(key);
    }
    else {
        value = await this.objCommon.GetValueFromIni(pluginFullPath + "plugin.ini", "PluginConfig", key);
    }
    if (value == null || value == "") {
        value = defaultValue;
    }
    return value;
};

/** 设置配置值 */
EditorMdConfig.prototype.setConfigValue = async function(key, value) {
    if (this.objCommon == null) {
        localStorage.setItem(key, value);
    }
    else {
        this.objCommon.SetValueToIni(pluginFullPath + "plugin.ini", "PluginConfig", key, value);
    }
};

/** 获得选项配置值 */
EditorMdConfig.prototype.getOptionSettings = async function() {
    if (this.__optionSettings == null) {
        this.__optionSettings = {
            // MarkdownStyle : getConfigValue("MarkdownStyle", "WizDefault"),
            // ReadTheme : getConfigValue("ReadTheme", "default"),
            EditToolbarButton : await this.getConfigValue("EditToolbarButton", "default"),
            EditToolbarTheme : await this.getConfigValue("EditToolbarTheme", "default"),
            EditEditorTheme : await this.getConfigValue("EditEditorTheme", "default"),
            EditPreviewTheme : await this.getConfigValue("EditPreviewTheme", "default"),
            EmojiSupport : await this.getConfigValue("EmojiSupport", "1"),
            HrefInBrowser : await this.getConfigValue("HrefInBrowser", "0"),
            KeymapMode : await this.getConfigValue("KeymapMode", "default"),
        };
    }
    return this.__optionSettings;
};

/** 设置选项配置值 */
EditorMdConfig.prototype.setOptionSettings = async function(optionsValue) {
    this.__optionSettings = optionsValue;
    this.setConfigValue("EditToolbarButton", optionsValue.EditToolbarButton);
    this.setConfigValue("EditToolbarTheme", optionsValue.EditToolbarTheme);
    this.setConfigValue("EditEditorTheme", optionsValue.EditEditorTheme);
    this.setConfigValue("EditPreviewTheme", optionsValue.EditPreviewTheme);
    this.setConfigValue("EmojiSupport", optionsValue.EmojiSupport);
    this.setConfigValue("HrefInBrowser", optionsValue.HrefInBrowser);
    this.setConfigValue("KeymapMode", optionsValue.KeymapMode);
};

/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////

function DocumentSaver(objApp, objPlugin) {
    this.objApp = objApp;
    this.objPlugin = objPlugin;
    this.objCommon = objApp.CommonUI;
}

/** 保存文档 */
DocumentSaver.prototype.saveDocument = async function(objDoc, documentContent) {
    if (objDoc) {
        documentContent = $('<div/>').text(documentContent).html();
        documentContent = documentContent.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');   // 替换制表符
        documentContent = documentContent.replace(/\n|\r|(\r\n)|(\u0085)|(\u2028)|(\u2029)/g, "<br/>").replace(/ /g, '\u00a0');
        documentContent += arrResult[1];
        documentContent = "<!DOCTYPE html><html><head><style id=\"wiz_custom_css\"></style></head><body>" + documentContent + "</body></html>";
        await objDoc.UpdateDocument3(documentContent, 0);
    }
}

/** 处理带图片内容 */
DocumentSaver.prototype.dealImgDoc = async function(doc) {
    let arrImgTags = "";

    async function dealImg(imgSrc) {
        const result = await this.saveImageToLocal(imgSrc);
        arrImgTags += result[1];
        return result[0];
    }

    const imgReg = /(!\[[^\[]*?\]\()(.+?)(\s+['"][\s\S]*?['"])?(\))/g;
    doc = doc.replace(imgReg, async function(whole, a, b, c, d) {
        if (c) {
            return a + await dealImg(b) + c + d;
        } else{
            return a + await dealImg(b) + d;
        }
    });

    let imgStrDiv = "";
    if (arrImgTags != "") {
        imgStrDiv = "<ed_tag name=\"markdownimage\" style=\"display:none;\">" + arrImgTags + "</ed_tag>";
    };
    return [doc, imgStrDiv];
}

/** 保存图片到本地临时目录, 返回新图片路径名和图片HTML标签内容 */
DocumentSaver.prototype.saveImageToLocal = async function(filename) {
    filename = filename.replace(/\\/g, '/');
    const imgName = filename.substring(filename.lastIndexOf('/') + 1);
    let filenameNew = filename;
    let tagImg = "";

    let imgFullPath = "";
    if (filename.indexOf(filesDirName) == 0) {
        imgFullPath = filesFullPath + imgName;
    }
    else {
        imgFullPath = filename;
        if (imgFullPath.indexOf("file:///") == 0) {
            imgFullPath = imgFullPath.substring(8);
        }
    }

    if (imgFullPath != "") {
        if (await this.objCommon.PathFileExists(imgFullPath)) {

            // 转换可能包含中文名的名称，转换成Unicode
            let imgNameNew = escape(imgName).replace(/%/g, '_');

            // 如果超过50个字符，则简短
            let extPos = imgNameNew.lastIndexOf('.');
            if (extPos == -1) {
                extPos = imgNameNew.length;
            }
            let imgNameWithoutExt = imgNameNew.substring(0, extPos);
            const imgExt = imgNameNew.substring(extPos);
            if (imgNameNew.length > 50) {
                imgNameWithoutExt = imgNameWithoutExt.substring(0, 35 - imgExt.length);
                imgNameNew = imgNameWithoutExt + imgExt;
            }

            // 路径不同，则进行拷贝
            let imgCopyToFullPath = filesFullPath + imgNameNew;
            if (imgFullPath != imgCopyToFullPath) {

                // 目标文件已经存在
                if (await this.objCommon.PathFileExists(imgCopyToFullPath)) {
                    const date = new Date();
                    imgNameNew = imgNameWithoutExt + date.getTime() + imgExt;
                    if (imgNameNew.length > 50) {
                        imgNameWithoutExt = imgNameWithoutExt.substring(0, 35 - imgExt.length);
                        imgNameNew = imgNameWithoutExt + date.getTime() + imgExt;
                    }
                    imgCopyToFullPath = filesFullPath + imgNameNew;
                }

                await this.objCommon.CopyFile(imgFullPath, imgCopyToFullPath);
            }

            filenameNew = filesDirName + imgNameNew;
            tagImg = "<img src=\"" + imgCopyToFullPath + "\">";
        }
    }

    return [filenameNew, tagImg];
}

/** 获得保存到本地的图片 */
DocumentSaver.prototype.getSavedLocalImage = async function(filename) {
    const res = await this.saveImageToLocal(filename);
    return res[0];
}

/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////

/**
 * Build web channel to WizNotePlus.
 */
async function createWebChannel(callback) {
    const Log = console;
    return new Promise((resolve, reject) => {
        const baseUrl = "ws://localhost:8848";
        Log.info("Connecting to WebSocket server of WizNotePlus at " + baseUrl + ".");

        let socket = new WebSocket(baseUrl);

        socket.onclose = function () {
            Log.error("web channel closed");
            state.isConnected = false;
        };

        socket.onerror = function (error) {
            Log.error("web channel error: " + error);
            state.isConnected = false;
            error.message = "Web channel error, failed to connect to WizNotPlus."
            reject(error);
        };

        socket.onopen = function () {
            Log.debug("WebSocket connected, setting up QWebChannel.");
            new QWebChannel(socket, async function (channel) {
                Log.debug("Web channel opened");

                const objApp = channel.objects["WizExplorerApp"];
                const objPlugin = channel.objects["JSPluginSpec"];
                const objModule = channel.objects["JSPluginModuleSpec"];
                window["WizExplorerApp"] = objApp // Only used for APIs test.
                window["JSPluginSpec"] = objPlugin;
                window["JSPluginModuleSpec"] = objModule;

                callback(objApp, objPlugin, objModule);

                resolve(true);
            });
        }
    })

}

$(function() {
    createWebChannel(async function(objApp, objPlugin, objModule) {
        const cfg = new EditorMdConfig(objApp);
        const docSaver = new DocumentSaver(objApp, objPlugin);
        const app = new EditorMdApp(objApp, objPlugin, cfg, docSaver);

        await app.init();
    })
})