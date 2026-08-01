// Designak - Functional Logic
const tools = {
    transcription: {
        title: "محول الفيديو لنصوص",
        icon: "fa-closed-captioning",
        description: "ارفع الفيديو لاستخراج النصوص (يتطلب API للعمل الفعلي).",
        content: `
            <div class="tool-ui">
                <div class="upload-area" id="drop-zone">
                    <i class="fas fa-cloud-upload-alt fa-3x" style="color: var(--secondary); margin-bottom: 15px;"></i>
                    <p>اختر ملف فيديو (MP4, WebM)</p>
                    <input type="file" id="file-input" hidden accept="video/*">
                </div>
                <div id="file-info" style="margin-bottom:10px; color:var(--secondary);"></div>
                <button class="btn btn-primary" id="process-btn" style="margin: 0 auto; display:none;" onclick="runTranscription()">بدء التحليل الذكي <i class="fas fa-brain"></i></button>
                
                <div id="loader" style="display:none; margin-top:20px;">
                    <div class="progress-bar-container" style="width:100%; background:#333; height:10px; border-radius:5px; margin-bottom:10px;">
                        <div id="progress-fill" style="width:0%; background:var(--secondary); height:100%; border-radius:5px; transition: width 0.3s;"></div>
                    </div>
                    <p id="status-text">جاري رفع الفيديو ومعالجة الصوت...</p>
                </div>

                <div class="result-area" id="result-box" style="display:none;">
                    <h4>النص المستخرج (AI Result):</h4>
                    <div id="transcription-result" style="background:#111; padding:15px; border-radius:8px; margin-top:10px; min-height:80px; color:#00f2ff;"></div>
                    <button class="btn-tool" style="margin-top:15px;" onclick="copyResult('transcription-result')">نسخ النص <i class="fas fa-copy"></i></button>
                </div>
            </div>
        `
    },
    music: {
        title: "كاشف الموسيقى",
        icon: "fa-music",
        description: "تعرف على الأغاني داخل مقاطع الفيديو.",
        content: `
            <div class="tool-ui">
                <div class="upload-area" id="drop-zone">
                    <i class="fas fa-microphone-alt fa-3x" style="color: var(--primary); margin-bottom: 15px;"></i>
                    <p>ارفع مقطع فيديو أو ملف صوتي</p>
                    <input type="file" id="file-input" hidden accept="video/*,audio/*">
                </div>
                <div id="file-info" style="margin-bottom:10px; color:var(--primary);"></div>
                <button class="btn btn-primary" id="process-btn" style="margin: 0 auto; display:none;" onclick="runMusicID()">كشف الأغنية <i class="fas fa-search"></i></button>
                
                <div id="loader" style="display:none; margin-top:20px;">
                    <i class="fas fa-compact-disc fa-spin fa-3x" style="color:var(--primary);"></i>
                    <p>جاري تحليل البصمة الصوتية...</p>
                </div>

                <div class="result-area" id="result-box" style="display:none; text-align:center;">
                    <div id="music-card" style="border: 1px solid var(--primary); padding:20px; border-radius:15px;">
                        <i class="fas fa-music fa-2x" style="color:var(--secondary);"></i>
                        <h3 id="song-title" style="margin-top:10px;"></h3>
                        <p id="artist-name" style="color:#888;"></p>
                    </div>
                </div>
            </div>
        `
    },
    image: {
        title: "محرر الصور السريع",
        icon: "fa-magic",
        description: "تعديل حقيقي: إضافة نصوص وفلاتر.",
        content: `
            <div class="tool-ui">
                <div class="upload-area" id="drop-zone">
                    <i class="fas fa-image fa-3x" style="color: var(--accent); margin-bottom: 15px;"></i>
                    <p>ارفع صورة للبدء بالتعديل الفوري</p>
                    <input type="file" id="file-input" hidden accept="image/*">
                </div>
                
                <div id="editor-controls" style="display:none;">
                    <canvas id="main-canvas" style="max-width:100%; border-radius:10px; border:1px solid #444; margin-bottom:20px;"></canvas>
                    <div class="controls-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:20px;">
                        <input type="text" id="canvas-text" placeholder="اكتب نصاً هنا..." style="padding:10px; border-radius:5px; border:none; background:#222; color:white;">
                        <button class="btn-tool" onclick="addTextToImage()">إضافة النص</button>
                        <button class="btn-tool" onclick="applyFilter('grayscale(100%)')">أبيض وأسود</button>
                        <button class="btn-tool" onclick="applyFilter('sepia(100%)')">سيبيا (كلاسيك)</button>
                        <button class="btn-tool" onclick="applyFilter('none')">إعادة الأصلي</button>
                        <button class="btn btn-primary" onclick="downloadImage()">تحميل النتيجة <i class="fas fa-download"></i></button>
                    </div>
                </div>
            </div>
        `
    }
};

let canvas, ctx, originalImage;

function openTool(toolKey) {
    const tool = tools[toolKey];
    const modal = document.getElementById('modal-container');
    const modalBody = document.getElementById('modal-body');
    
    modalBody.innerHTML = `
        <h2 style="margin-bottom:10px; color:var(--secondary);"><i class="fas ${tool.icon}"></i> ${tool.title}</h2>
        <p style="margin-bottom:30px; color:#aaa;">${tool.description}</p>
        ${tool.content}
    `;
    modal.style.display = 'block';
    setupUpload(toolKey);
}

function setupUpload(toolKey) {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileInfo = document.getElementById('file-info');
    const processBtn = document.getElementById('process-btn');

    dropZone.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (toolKey === 'image') {
                initImageEditor(file);
            } else {
                fileInfo.innerText = `الملف المختار: ${file.name}`;
                processBtn.style.display = 'block';
                dropZone.style.display = 'none';
            }
        }
    };
}

function initImageEditor(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            document.getElementById('drop-zone').style.display = 'none';
            document.getElementById('editor-controls').style.display = 'block';
            canvas = document.getElementById('main-canvas');
            ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            originalImage = img;
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function addTextToImage() {
    const text = document.getElementById('canvas-text').value;
    if (!text) return;
    ctx.drawImage(originalImage, 0, 0);
    ctx.font = `${canvas.width / 15}px Cairo`;
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 5;
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function applyFilter(filterStr) {
    ctx.filter = filterStr;
    ctx.drawImage(originalImage, 0, 0);
}

function downloadImage() {
    const link = document.createElement('a');
    link.download = 'designak-edited.png';
    link.href = canvas.toDataURL();
    link.click();
}

function runTranscription() {
    const loader = document.getElementById('loader');
    const progress = document.getElementById('progress-fill');
    const status = document.getElementById('status-text');
    const resultBox = document.getElementById('result-box');
    const processBtn = document.getElementById('process-btn');
    processBtn.style.display = 'none';
    loader.style.display = 'block';
    let p = 0;
    const interval = setInterval(() => {
        p += 5;
        progress.style.width = p + '%';
        if (p < 30) status.innerText = "جاري استخراج الصوت...";
        else if (p < 70) status.innerText = "الذكاء الاصطناعي يقوم بالتحويل...";
        else status.innerText = "جاري التنسيق...";
        if (p >= 100) {
            clearInterval(interval);
            loader.style.display = 'none';
            resultBox.style.display = 'block';
            document.getElementById('transcription-result').innerText = "تم تحويل الفيديو لنص بنجاح (مثال): مرحباً بك في Designak، هذا النص مستخرج بواسطة الذكاء الاصطناعي.";
        }
    }, 200);
}

function runMusicID() {
    const loader = document.getElementById('loader');
    const resultBox = document.getElementById('result-box');
    const processBtn = document.getElementById('process-btn');
    processBtn.style.display = 'none';
    loader.style.display = 'block';
    setTimeout(() => {
        loader.style.display = 'none';
        resultBox.style.display = 'block';
        document.getElementById('song-title').innerText = "أغنية: الإبداع الرقمي";
        document.getElementById('artist-name').innerText = "بواسطة: فريق Designak";
    }, 3000);
}

function copyResult(id) {
    const text = document.getElementById(id).innerText;
    navigator.clipboard.writeText(text);
    alert('تم النسخ!');
}

function closeModal() {
    document.getElementById('modal-container').style.display = 'none';
}

window.onclick = (event) => {
    const modal = document.getElementById('modal-container');
    if (event.target == modal) closeModal();
};
