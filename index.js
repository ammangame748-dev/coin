const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// تشغيل الملفات الثابتة من المجلد الحالي
app.use(express.static(__dirname));

// أي طلب يجي للموقع يرجع ملف index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), (err) => {
        if (err) {
            res.status(404).send("خطأ: ملف index.html غير موجود في المسار الرئيسي للسيرفر!");
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
