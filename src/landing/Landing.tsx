// صفحة الهبوط العامة (للزوار) — بيانات الطبيب من صفحته على فيسبوك، والحجز بالاتصال/واتساب
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import InstallButton from '../pwa/InstallButton';
import { Icon } from '../utils/icons';
import { DOCTOR, POSTS, SERVICES, STEPS } from './content';
import './landing.css';

const img = (f: string) => `${import.meta.env.BASE_URL}landing/${f}`;
const tel = (n: string) => `tel:${n}`;

function WhatsappIcon() {
  return <svg className="icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.7.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z" /></svg>;
}
function FacebookIcon() {
  return <svg className="icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.5 1.6-1.5h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.3H7.4V14h2.8v8h3.3z" /></svg>;
}

export default function Landing() {
  const [menu, setMenu] = useState(false);
  const [view, setView] = useState<number | null>(null);
  useEffect(() => {
    document.title = `${DOCTOR.short} — ${DOCTOR.title} | ${DOCTOR.city}`;
    if (view === null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setView(null);
      if (e.key === 'ArrowLeft') setView((v) => (v === null ? v : (v + 1) % POSTS.length));
      if (e.key === 'ArrowRight') setView((v) => (v === null ? v : (v - 1 + POSTS.length) % POSTS.length));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [view]);
  const go = () => setMenu(false);
  const main = DOCTOR.phones[0];

  return (
    <div className="lp" dir="rtl">
      {/* ===== الشريط العلوي ===== */}
      <header className="lp-nav">
        <div className="lp-wrap lp-nav__in">
          <a href="#top" className="lp-brand" onClick={go}>
            <img src={img('logo.png')} alt={DOCTOR.short} />
            <span><strong>{DOCTOR.short}</strong><small>{DOCTOR.title}</small></span>
          </a>
          <nav className={`lp-links ${menu ? 'open' : ''}`} aria-label="أقسام الصفحة">
            <a href="#services" onClick={go}>الخدمات</a>
            <a href="#approach" onClick={go}>طريقتنا</a>
            <a href="#posts" onClick={go}>من صفحتنا</a>
            <a href="#contact" onClick={go}>التواصل</a>
            <InstallButton className="lp-btn lp-btn--sm lp-btn--outline" />
          </nav>
          <span className="lp-nav__auth">
            <Link to="/login" className="lp-login">تسجيل الدخول</Link>
            <Link to="/signup" className="lp-signup">إنشاء حساب</Link>
          </span>
          <a className="lp-btn lp-btn--sm lp-nav__cta" href={tel(main.number)}><Icon name="phone" size={16} />احجز الآن</a>
          <button className="lp-burger" aria-label="القائمة" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name={menu ? 'close' : 'menu'} size={22} /></button>
        </div>
      </header>

      {/* ===== البداية ===== */}
      <section className="lp-hero" id="top">
        <div className="lp-wrap lp-hero__in">
          <div className="lp-hero__text">
            <span className="lp-pill"><span className="lp-dot" />طوارئ 24 ساعة · {DOCTOR.city}</span>
            <h1>{DOCTOR.name}</h1>
            <p className="lp-hero__title">{DOCTOR.title}</p>
            <p className="lp-hero__lead">التشخيص الصح هو أول خطوة لعلاج أسرع وأدق — بكشف دقيق وسونار، وخطة علاج مناسبة لحياتك وشغلك. والجراحة مش أول حل.</p>
            <div className="lp-hero__cta">
              <a className="lp-btn" href={tel(main.number)}><Icon name="phone" size={18} />اتصل واحجز: <span className="num">{main.number}</span></a>
              <a className="lp-btn lp-btn--wa" href={`https://wa.me/${DOCTOR.whatsapp}`} target="_blank" rel="noopener noreferrer"><WhatsappIcon />واتساب</a>
              <Link className="lp-btn lp-btn--outline" to="/signup"><Icon name="calendar" size={18} />احجز أونلاين</Link>
            </div>
            <ul className="lp-stats">
              {DOCTOR.stats.map((s) => <li key={s.label}><strong>{s.value}</strong><span>{s.label}</span></li>)}
            </ul>
          </div>
          <div className="lp-hero__media">
            <img src={img('post-05.jpg')} alt="الكشف بالسونار" className="lp-hero__main" />
            <img src={img('post-09.jpg')} alt="الحقن بالسونار" className="lp-hero__float" />
            <div className="lp-hero__badge"><Icon name="scan" size={20} /><span>كشف وحقن<br />بالسونار</span></div>
          </div>
        </div>
      </section>

      {/* ===== الخدمات ===== */}
      <section className="lp-sec" id="services">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-kicker">الخدمات</span><h2>كل اللي يخص صحة عظامك ومفاصلك</h2><p>من الكشف والتشخيص بالسونار لحد العلاج والمتابعة — في مكان واحد في {DOCTOR.city}.</p></div>
          <div className="lp-services">
            {SERVICES.map((s) => (
              <article className="lp-service" key={s.title}>
                <span className="lp-service__ic"><Icon name={s.icon} size={24} /></span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== طريقتنا ===== */}
      <section className="lp-sec lp-sec--tint" id="approach">
        <div className="lp-wrap lp-approach">
          <div className="lp-approach__media"><img src={img('post-03.jpg')} alt="اتشخص صح قبل العلاج" /></div>
          <div>
            <div className="lp-head lp-head--start"><span className="lp-kicker">طريقتنا</span><h2>التشخيص الصح مش بس أشعة وتحاليل</h2><p>ده فهم كامل لحالتك وطبيعة يومك — عشان العلاج يناسبك من غير ما يعطّل حياتك.</p></div>
            <ol className="lp-steps">
              {STEPS.map((s, i) => <li key={s.title}><span className="lp-steps__n num">{i + 1}</span><div><h3>{s.title}</h3><p>{s.text}</p></div></li>)}
            </ol>
            <a className="lp-btn" href={tel(main.number)}><Icon name="calendar" size={18} />احجز كشفك</a>
          </div>
        </div>
      </section>

      {/* ===== البوستات ===== */}
      <section className="lp-sec" id="posts">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-kicker">من صفحتنا</span><h2>نصائح ومعلومات تهمك</h2><p>تابعنا على فيسبوك لكل ما يخص صحة العظام والصحة العامة.</p></div>
          <div className="lp-posts">
            {POSTS.map((p, i) => (
              <button key={p.src} className="lp-post" onClick={() => setView(i)} aria-label={`عرض: ${p.alt}`}>
                <img src={img(p.src)} alt={p.alt} loading="lazy" />
              </button>
            ))}
          </div>
          <div className="lp-center"><a className="lp-btn lp-btn--outline" href={DOCTOR.facebook} target="_blank" rel="noopener noreferrer"><FacebookIcon />تابع الصفحة على فيسبوك</a></div>
        </div>
      </section>

      {/* ===== التواصل ===== */}
      <section className="lp-sec lp-sec--dark" id="contact">
        <div className="lp-wrap lp-contact">
          <div>
            <span className="lp-kicker lp-kicker--light">التواصل والحجز</span>
            <h2>احجز كشفك دلوقتي</h2>
            <p className="lp-contact__lead">اتصل بأي رقم من أرقام الحجز، أو ابعتلنا على واتساب أو ماسنجر. الطوارئ متاحة 24 ساعة.</p>
            <ul className="lp-contact__list">
              {DOCTOR.phones.map((p) => (
                <li key={p.number}><Icon name="phone" size={20} /><span><small>{p.label}</small><a href={tel(p.number)} className="num">{p.number}</a></span></li>
              ))}
              <li><Icon name="pin" size={20} /><span><small>العنوان</small><a href={DOCTOR.mapsUrl} target="_blank" rel="noopener noreferrer">{DOCTOR.address}</a></span></li>
              <li><Icon name="doc" size={20} /><span><small>البريد الإلكتروني</small><a href={`mailto:${DOCTOR.email}`} className="num">{DOCTOR.email}</a></span></li>
            </ul>
          </div>
          <div className="lp-contact__card">
            <img src={img('cover.jpg')} alt={DOCTOR.name} />
            <div className="lp-contact__actions">
              <a className="lp-btn lp-btn--block" href={tel(main.number)}><Icon name="phone" size={18} />اتصل الآن</a>
              <a className="lp-btn lp-btn--block lp-btn--wa" href={`https://wa.me/${DOCTOR.whatsapp}`} target="_blank" rel="noopener noreferrer"><WhatsappIcon />واتساب</a>
              <a className="lp-btn lp-btn--block lp-btn--fb" href={DOCTOR.messenger} target="_blank" rel="noopener noreferrer"><FacebookIcon />ماسنجر</a>
              <a className="lp-btn lp-btn--block lp-btn--ghost" href={DOCTOR.mapsUrl} target="_blank" rel="noopener noreferrer"><Icon name="pin" size={18} />الموقع على الخريطة</a>
            </div>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot__in">
          <span>© {new Date().getFullYear()} {DOCTOR.name} — {DOCTOR.title}</span>
          <span className="lp-foot__links"><a href={DOCTOR.facebook} target="_blank" rel="noopener noreferrer">فيسبوك</a><Link to="/login">تسجيل الدخول</Link><Link to="/signup">إنشاء حساب</Link></span>
        </div>
      </footer>

      {/* زرار اتصال ثابت على الموبايل */}
      <a className="lp-fab" href={tel(main.number)} aria-label="اتصل للحجز"><Icon name="phone" size={22} /></a>

      {view !== null && (
        <div className="lp-lightbox" role="dialog" aria-modal="true" aria-label={POSTS[view].alt} onClick={() => setView(null)}>
          <button className="lp-lightbox__x" aria-label="إغلاق" onClick={() => setView(null)}><Icon name="close" size={24} /></button>
          <button className="lp-lightbox__nav lp-lightbox__nav--prev" aria-label="السابق" onClick={(e) => { e.stopPropagation(); setView((view - 1 + POSTS.length) % POSTS.length); }}><Icon name="chevronLeft" size={26} /></button>
          <img src={img(POSTS[view].src)} alt={POSTS[view].alt} onClick={(e) => e.stopPropagation()} />
          <button className="lp-lightbox__nav lp-lightbox__nav--next" aria-label="التالي" onClick={(e) => { e.stopPropagation(); setView((view + 1) % POSTS.length); }}><Icon name="chevron" size={26} /></button>
        </div>
      )}
    </div>
  );
}
