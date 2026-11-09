const f=document.getElementById('contacto'),m=document.getElementById('msg'),b=f.querySelector('button');
f.addEventListener('submit',async e=>{
 e.preventDefault();m.className='msg';m.textContent='';
 const d=Object.fromEntries(new FormData(f));
 const falta=[];
 if(!d.nombre.trim())falta.push('tu nombre');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo.trim()))falta.push('un correo válido');
 if(!d.mensaje.trim())falta.push('tu mensaje');
 if(!d.acepta_terminos)falta.push('aceptar los términos');
 if(!d.autorizacion)falta.push('autorizar el tratamiento de datos');
 if(!d.mayor_edad)falta.push('confirmar que eres mayor de 18 años');
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
