-- 927: ملفات PDF في التمرينات (إرشادات/جداول تمارين جاهزة) — بتتضاف لأنواع الملفات المسموحة في exercise-media.
update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf'] where id = 'exercise-media';
