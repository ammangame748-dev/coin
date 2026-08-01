const express = require('express');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const app = express();
const PORT = process.env.PORT || 3000;

// إعداد Cloudinary باستخدام المتغيرات التي ستحصل عليها
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ dest: 'uploads/' });

app.use(express.static(__dirname));

// أداة تعديل الصور: رفع الصورة لـ Cloudinary مع إزالة الخلفية
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path, {
        // ميزة إزالة الخلفية (تتطلب تفعيل Add-on في Cloudinary أو استخدام فلاتر)
        transformation: [{ effect: "improve" }] 
    });
    res.json({ url: result.secure_url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Designak Server running on port ${PORT}`);
});
