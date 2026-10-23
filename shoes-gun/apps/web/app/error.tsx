'use client';
export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){return <div className="container empty-state empty-page"><span className="eyebrow">نحاول مرة تانية</span><h1>في حاجة مش مظبوطة.</h1><p>مقدرناش نحمّل الصفحة دلوقتي. حاول مرة تانية بعد لحظات.</p><button className="button red" onClick={()=>reset()}>إعادة المحاولة</button></div>;}
