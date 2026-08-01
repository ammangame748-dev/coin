const tools = {
    transcription: {
        title: "محول الفيديو لنصوص",
        icon: "fa-closed-captioning",
        description: "قم برفع ملف الفيديو لاستخراج النصوص بدقة عالية.",
        content: `
            <div class="tool-ui">
                <div class="upload-area" id="drop-zone">
                    <i class="fas fa-cloud-upload-alt fa-3x" style="color: var(--secondary); margin-bottom: 15px;"></i>
                    <p>اسحب وأفلت ملف الفيديو هنا أو اضغط للاختيار</p>
                    <input type="file" id="file-input" hidden accept="video/*">
                </div>
                <button class="btn btn-primary" style="margin: 0 auto;" onclick="simulateTool('transcription')">بدء المعالجة <i class="fas fa-cogs"></i></button>
                <div id="loader" style="display:none; margin-top:20px;"><i class="fas fa-spinner fa-spin"></i> جاري استخراج النص...</div>
                <div class="result-area" id="result-box" style="display:none;">
                    <h4>النص المستخرج:</h4>
                    <p id="result-text"></p>
                    <button class="btn-tool" style="margin-top:10px;" onclick="copyText()">نسخ النص <i class="fas fa-copy"></i></button>
                </div>
            </div>
        `
    },
    music: {
        title: "كاشف الموسيقى",
        icon: "fa-music",
        description: "ارفع الفيديو لمعرفة اسم الأغنية والمغني.",
        content: `
            <div class="tool-ui">
                <div class="upload-area" id="drop-zone">
                    <i class="fas fa-music fa-3x" style="color: var(--primary); margin-bottom: 15px;"></i>
                    <p>ارفع الفيديو الذي يحتوي على الموسيقى</p>
                    <input type="file" id="file-input" hidden accept="video/*,audio/*">
                </div>
                <button class="btn btn-primary" style="margin: 0 auto;" onclick="simulateTool('music')">التعرف على الموسيقى <i class="fas fa-search"></i></button>
                <div id="loader" style="display:none; margin-top:20px;"><i class="fas fa-spinner fa-spin"></i> جاري البحث في قاعدة البيانات...</div>
                <div class="result-area" id="result-box" style="display:none; text-align:center;">
                    <i class="fas fa-compact-disc fa-4x pulse" style="color: var(--secondary);"></i>
                    <h3 id="music-name" style="margin-top:15px;"></h3>
                    <p id="artist-name"></p>
                </div>
            </div>
        `
    },
    image: {
        title: "محرر الصور السريع",
        icon: "fa-magic",
        description: "أدوات تعديل الصور الفورية.",
        content: `
            <div class="tool-ui">
                <div class="upload-area" id="drop-zone">
                    <i class="fas fa-image fa-3x" style="color: var(--accent); margin-bottom: 15px;"></i>
                    <p>ارفع الصورة للبدء في التعديل</p>
                    <input type="file" id="file-input" hidden accept="image/*">
                </div>
                <div class="image-actions" style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
                    <button class="btn-tool" onclick="simulateTool('image', 'bg')">إزالة الخلفية</button>
                    <button class="btn-tool" onclick="simulateTool('image', 'text')">إضافة نص متحرك</button>
                    <button class="btn-tool" onclick="simulateTool('image', 'convert')">تحويل الصيغة</button>
                </div>
                <div id="loader" style="display:none; margin-top:20px;"><i class="fas fa-spinner fa-spin"></i> جاري المعالجة...</div>
                <div class="result-area" id="result-box" style="display:none;">
                    <p>تمت العملية بنجاح!</p>
                    <button class="btn btn-primary" style="margin: 10px auto;">تحميل الصورة المعدلة <i class="fas fa-download"></i></button>
                </div>
            </div>
        `
    }
};

const modal = document.getElementById('modal-container');
const modalBody = document.getElementById('modal-body');

function openTool(toolKey) {
    const tool = tools[toolKey];
    modalBody.innerHTML = `
        <h2 style="margin-bottom:10px; color:var(--secondary);"><i class="fas ${tool.icon}"></i> ${tool.title}</h2>
        <p style="margin-bottom:30px; color:#aaa;">${tool.description}</p>
        ${tool.content}
    `;
    modal.style.display = 'block';

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    dropZone.onclick = () => fileInput.click();
}

function closeModal() {
    modal.style.display = 'none';
}

window.onclick = (event) => {
    if (event.target == modal) closeModal();
};

function simulateTool(type, subType = '') {
    const loader = document.getElementById('loader');
    const resultBox = document.getElementById('result-box');

    loader.style.display = 'block';
    resultBox.style.display = 'none';

    setTimeout(() => {
        loader.style.display = 'none';
        resultBox.style.display = 'block';

        if (type === 'transcription') {
            document.getElementById('result-text').innerText = "مرحباً بكم في موقع Designak. هذا نص تجريبي مستخرج من الفيديو الذي قمت برفعه. النظام يدعم العربية والإنجليزية بذكاء اصطناعي متطور.";
        } else if (type === 'music') {
            document.getElementById('music-name').innerText = "اسم الأغنية: نغمة النجاح";
            document.getElementById('artist-name').innerText = "الفنان: ذكاء ديزاينك";
        } else if (type === 'image') {
            resultBox.innerHTML = `<p>تم تنفيذ ${subType === 'bg' ? 'إزالة الخلفية' : subType === 'text' ? 'إضافة النص' : 'التحويل'} بنجاح!</p>
                                   <button class="btn btn-primary" style="margin: 10px auto;">تحميل النتيجة <i class="fas fa-download"></i></button>`;
        }
    }, 2000);
}

function copyText() {
    const text = document.getElementById('result-text').innerText;
    navigator.clipboard.writeText(text);
    alert('تم نسخ النص إلى الحافظة!');
}

const logo = document.getElementById('main-logo');
logo.onmouseover = () => {
    logo.style.transform = 'rotate(5deg) scale(1.1)';
};
logo.onmouseout = () => {
    logo.style.transform = 'rotate(0) scale(1)';
};
