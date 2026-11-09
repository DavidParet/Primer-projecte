'use strict';
/* NexLupa preview-only pilot. No account data in localStorage or logs. */
(() => {
  const status=document.getElementById('status');
  const form=document.getElementById('login');
  const signed=document.getElementById('authenticated');
  const email=document.getElementById('email');
  const password=document.getElementById('password');
  const submit=document.getElementById('signin');
  const signout=document.getElementById('signout');
  const statuses=Object.freeze({
    not_found:'Aquest pilot encara no està habilitat en aquest entorn.',
    signed_out:'Accés disponible només per a comptes de prova autoritzats.',
    authenticated:'Sessió de proves verificada.',
    invalid_credentials:'Credencials no vàlides o compte no autoritzat.',
    auth_unavailable:'El servei d’autenticació no està disponible. No s’ha iniciat cap sessió.',
    auth_cookie_missing:'La sessió no s’ha pogut establir de forma segura.',
    auth_verification_failed:'No s’ha pogut verificar la sessió.',
    remote_logout_unconfirmed:'S’ha esborrat la sessió d’aquest navegador, però no s’ha pogut confirmar el tancament remot.',
    forbidden_origin:'Aquest origen no està autoritzat.',
    forbidden_host:'Aquest domini no està autoritzat.',
    invalid_request:'Revisa les dades introduïdes.'
  });
  const describe=(value)=>statuses[value]||'No ha estat possible completar l’operació.';
  const show=(state)=>{
    status.textContent=describe(state);
    const active=state==='authenticated';
    const available=state==='signed_out'||active||state==='invalid_credentials';
    form.classList.toggle('hidden',!available||active);
    signed.classList.toggle('hidden',!active);
  };
  async function call(method,payload){
    const opts={method,credentials:'same-origin',cache:'no-store',
      headers:{Accept:'application/json'}};
    if(payload){
      opts.headers['Content-Type']='application/json';
      opts.body=JSON.stringify(payload);
    }
    const reply=await fetch('/api/pilot-auth',opts);
    let body;
    try{body=await reply.json();}catch{return {state:'auth_unavailable'};}
    return {state:body?.state||'auth_unavailable'};
  }
  async function refresh(){
    try{show((await call('GET')).state);}
    catch{show('auth_unavailable');}
  }
  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
    if(submit.disabled)return;
    submit.disabled=true;
    const details={action:'sign_in',email:email.value.trim(),password:password.value};
    password.value='';
    try{show((await call('POST',details)).state);}
    catch{show('auth_unavailable');}
    finally{details.password='';submit.disabled=false;}
  });
  signout.addEventListener('click',async()=>{
    signout.disabled=true;
    try{
      const reply=await call('POST',{action:'sign_out'});
      show(reply.state);
      if(reply.state==='remote_logout_unconfirmed'){
        signed.classList.add('hidden');
        form.classList.remove('hidden');
      }
    }catch{show('auth_unavailable');}
    finally{signout.disabled=false;}
  });
  refresh();
})();
