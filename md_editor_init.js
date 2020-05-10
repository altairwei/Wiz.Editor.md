async function initEditorApp() {
    const objApp = WizExplorerApp;
    const objCommon = objApp.CommonUI;

    const curr_doc = await objApp.Window.CurrentDocument();

    document.title = curr_doc.Title;

    // Extract document content
    let tempPath = await objCommon.GetSpecialFolder("TemporaryFolder");
    tempPath += "editor_md_temp/"; /** Temporary folder for Wiz.Editor.md */
    await objCommon.CreateDirectory(tempPath);
    tempPath += curr_doc.GUID + "/"; /** Temporary folder for current document */
    await objCommon.CreateDirectory(tempPath);
    await objCommon.CreateDirectory(tempPath + "index_files/");
    curr_doc.SaveToFolder(tempPath);

    // Get document
    const mdSourceCode = await loadDocument(tempPath + "index.html");
    createEditorMdApp(mdSourceCode);

    // Remove C++ object on heap
    curr_doc.deleteLater();
}

async function loadDocument(htmlFileName) {
    const objApp = WizExplorerApp;
    const objCommon = objApp.CommonUI;

    let code = "";

    // Load html content
    let content = await objCommon.LoadTextFromFile(htmlFileName);
    content = content.match(/<body[^>]*>[\s\S]*<\/body>/gi)[0];

    var tempBody = document.body.innerHTML;
    document.body.innerHTML = content;

    var imgs = document.body.getElementsByTagName('img');
    if (imgs.length) {
        for (var i = imgs.length - 1; i >= 0; i--) {
            var pi = imgs[i];
            if (pi && pi.parentNode.getAttribute("name") != "markdownimage") {
                var imgmd = document.createTextNode("![](" + pi.getAttribute("src") + ")");
                $(pi).replaceWith(imgmd);
            }
        }
    }

    var links = document.body.getElementsByTagName('a');
    if (links.length) {
        for (var i = links.length - 1; i >= 0; i--) {
            var pi = links[i];
            if (pi && pi.getAttribute("href").indexOf("wiz://open_") != -1) {
                var linkmd = document.createTextNode("[" + pi.textContent + "](" + pi.getAttribute("href") + ")");
                $(pi).replaceWith(linkmd);
            }
        }
    }

    content = document.body.innerText;
    document.body.innerHTML = tempBody;
    code = content;

    /*code = objDocument.GetText(0);*/
    code = code.replace(/\u00a0/g, ' ');

    // 如果用原生编辑器保存过图片，会被替换成错的图片路径
    //var imgErrorPath = guid + "_128_files/";
    //code = code.replace(new RegExp(imgErrorPath, "g"), filesDirName);

    return code;
};

/**
 * Build web channel to WizNotePlus.
 */
async function createWebChannel() {
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
                window["WizExplorerApp"] = channel.objects["WizExplorerApp"]; // Only used for APIs test.
                resolve(true);
            });
        }
    })

}

$(function() {
    createWebChannel().then(initEditorApp)
})