const f=document.getElementById('contacto'),m=document.getElementById('msg'),b=f.querySelector('button');
f.addEventListener('submit',async e=>{
 e.preventDefault();m.className='msg';m.textContent='';
 const d={};
 for(const el of f.elements){
  if(!el.name)continue;
  if(el.type==='checkbox')d[el.name]=el.checked;
  else d[el.name]=el.value;
 }
 const falta=[];
 if(!d.nombre.trim())falta.push('tu nombre');
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(d.correo.trim()))falta.push('un correo válido');
 if(!d.mensaje.trim())falta.push('contarnos qué necesitas');
 if(!d.terminos)falta.push('aceptar los Términos y condiciones');
 if(!d.privacidad)falta.push('autorizar el tratamiento de tus datos');
 if(!d.mayor_edad)falta.push('declarar que eres mayor de 18 años');
 if(falta.length){m.className='msg err';m.textContent='Falta '+falta.join(', ')+'.';return}
 b.disabled=true;b.textContent='Enviando…';
 try{
  const r=await fetch('/api/contacto',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});
  const j=await r.json().catch(()=>({}));
  if(r.ok&&j.ok){f.classList.add('sent');document.getElementById('ok').focus()}
  else{m.className='msg err';m.textContent=j.error||'No pudimos enviar tu mensaje. Intenta de nuevo o escríbenos a hola@northik.ai.'}
 }catch{m.className='msg err';m.textContent='No pudimos enviar tu mensaje. Revisa tu conexión o escríbenos a hola@northik.ai.'}
 b.disabled=false;b.textContent='Enviar';
});
