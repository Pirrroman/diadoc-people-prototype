export const RULES_VERSION = 'demo-2026-10-v1';
export const MAX_BYTES = 10 * 1024 * 1024;
export const ORGS = [
  { id: 'auto', name: 'Автосервис «Маяк»', legal: 'ООО «Маяк Авто»', initials: 'МА', contact: 'Администратор автосервиса', phone: '+7 (900) 000-00-01' },
  { id: 'travel', name: 'Бюро путешествий «Ветер»', legal: 'ООО «Ветер»', initials: 'В', contact: 'Ваш менеджер', phone: '+7 (900) 000-00-02' },
];
export const STATUS = { draft:'Черновик', waiting:'Ждёт подписи', signed:'Подписан · демо', declined:'Отказ', revoked:'Отозван', expired:'Срок истёк' };
export const EVENTS = { created:'Создан черновик', sent:'Создано демоприглашение', resent:'Приглашение обновлено', access_code:'Создан тестовый код входа', access_verified:'Доступ подтверждён в демо', viewed:'Открыт документ', sign_code:'Создан тестовый код подписания', signed:'Завершено демоподписание', declined:'Получатель отказался', revoked:'Документ отозван', updated:'Черновик изменён', invalid_code:'Введён неверный тестовый код' };
export class DomainError extends Error {}
const fail = message => { throw new DomainError(message); };
export function normalizePhone(value) { const n=String(value).replace(/\D/g,''); return /^8\d{10}$/.test(n)?'7'+n.slice(1):n; }
export function phoneDisplay(value) { const n=normalizePhone(value); return /^7\d{10}$/.test(n)?`+7 (${n.slice(1,4)}) ${n.slice(4,7)}-${n.slice(7,9)}-${n.slice(9)}`:value; }
export function maskPhone(value) { const n=normalizePhone(value); return `+7 ••• •••-${n.slice(-4,-2)}-${n.slice(-2)}`; }
export function validateInput(input) {
  if (!input.title?.trim() || input.title.trim().length>160) fail('Введите название документа: от 1 до 160 символов.');
  if (!input.recipient?.trim() || input.recipient.trim().length<3 || input.recipient.trim().length>120) fail('Укажите имя получателя: от 3 до 120 символов.');
  if (!/^7\d{10}$/.test(normalizePhone(input.phone))) fail('Введите российский номер: +7 и ещё 10 цифр.');
  if (input.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length>200)) fail('Проверьте адрес электронной почты.');
}
export function effectiveStatus(doc, now=Date.now()) { return doc.status==='waiting' && doc.expiresAt<=now?'expired':doc.status; }
export function event(doc, type, now, detail='') { doc.events.push({id:crypto.randomUUID(),type,at:now,detail}); }
export function newDocument(input, now=Date.now()) {
  validateInput(input);
  const doc={id:crypto.randomUUID(),orgId:input.orgId,title:input.title.trim(),recipient:input.recipient.trim(),phone:normalizePhone(input.phone),email:input.email?.trim()||'',status:'draft',version:1,createdAt:now,updatedAt:now,events:[],invitationCount:0,assisted:false,seed:false};
  event(doc,'created',now);return doc;
}
export function requireOrg(doc, orgId) { if (doc.orgId!==orgId) fail('Документ недоступен выбранной организации.'); }
function requireWaiting(doc,now) { if (effectiveStatus(doc,now)!=='waiting') fail('Документ больше не ожидает подписи. Обновите страницу.'); }
function checkCode(doc,purpose,code,now) {
  const c=doc.challenge;
  if(!c || c.purpose!==purpose || c.version!==doc.version) fail('Сначала получите новый код.');
  if(c.used) fail('Этот код уже использован. Получите новый.');
  if(c.expiresAt<=now) fail('Код устарел. Получите новый.');
  if(c.attempts>=5) fail('Попытки закончились. Получите новый код.');
  if(String(code)!==c.code) {c.attempts++; event(doc,'invalid_code',now); return {error:c.attempts>=5?'Попытки закончились. Получите новый код.':`Неверный код. Осталось попыток: ${5-c.attempts}.`};}
  c.used=true;return {};
}
export function transition(original, action, context={}, now=Date.now()) {
  const doc=structuredClone(original);const {type}=action;let result={};
  if(['send','resend','revoke','edit','assistance'].includes(type)) requireOrg(doc,context.orgId);
  if(type==='send') {
    if(doc.status!=='draft') fail('Можно отправить только черновик.');
    if(!doc.hash || !doc.fileKey) fail('Добавьте PDF перед отправкой.');
    doc.status='waiting';doc.token=crypto.randomUUID()+crypto.randomUUID();doc.sentAt=now;doc.expiresAt=now+72*3600_000;doc.invitationCount++;event(doc,'sent',now);
  } else if(type==='resend') {
    requireWaiting(doc,now);if(now-(doc.lastResentAt||doc.sentAt)<30_000) fail('Подождите 30 секунд перед повторным приглашением.');
    doc.invitationCount++;doc.lastResentAt=now;event(doc,'resent',now);
  } else if(type==='edit') {
    if(doc.status!=='draft') fail('После отправки документ нельзя изменить. Создайте новый.');validateInput(action.input);
    Object.assign(doc,{title:action.input.title.trim(),recipient:action.input.recipient.trim(),phone:normalizePhone(action.input.phone),email:action.input.email?.trim()||''});doc.version++;event(doc,'updated',now);
  } else if(type==='revoke') {
    requireWaiting(doc,now);doc.status='revoked';delete doc.challenge;event(doc,'revoked',now);
  } else if(type==='request_code') {
    requireWaiting(doc,now);
    if(!['access','sign'].includes(action.purpose)) fail('Неизвестное действие.');
    if(action.purpose==='sign' && (!context.access || !action.accepted || !context.viewed)) fail('Откройте документ и примите условия демоподписания.');
    if(doc.challenge?.purpose===action.purpose && now-doc.challenge.createdAt<30_000) fail('Подождите 30 секунд перед новым кодом.');
    const nums=new Uint32Array(1);crypto.getRandomValues(nums);
    doc.challenge={purpose:action.purpose,code:String(nums[0]%900000+100000),createdAt:now,expiresAt:now+5*60_000,version:doc.version,attempts:0,used:false};
    event(doc,action.purpose==='access'?'access_code':'sign_code',now);result={challenge:doc.challenge};
  } else if(type==='verify_access') {
    requireWaiting(doc,now);result=checkCode(doc,'access',action.code,now);
    if(!result.error)event(doc,'access_verified',now);
  } else if(type==='view') {
    requireWaiting(doc,now);if(!context.access)fail('Подтвердите доступ к документу.');
    if(!doc.events.some(e=>e.type==='viewed'))event(doc,'viewed',now);
  } else if(type==='sign') {
    // Replays return the same result; a revoked/expired document can never become signed.
    if(doc.status==='signed' && context.access)return {doc,result:{alreadySigned:true}};
    requireWaiting(doc,now);if(!context.access||!context.viewed||!action.accepted)fail('Подтвердите доступ, откройте документ и примите условия.');
    if(context.version!==doc.version || context.hash!==doc.hash) fail('Версия документа изменилась. Откройте её заново.');
    result=checkCode(doc,'sign',action.code,now);
    if(!result.error){doc.status='signed';doc.signedAt=now;doc.proof={id:crypto.randomUUID(),demo:true,version:doc.version,hash:doc.hash,at:now,rules:RULES_VERSION};event(doc,'signed',now);delete doc.challenge;}
  } else if(type==='decline') {
    requireWaiting(doc,now);if(!context.access)fail('Подтвердите доступ к документу.');doc.status='declined';doc.reason=String(action.reason||'Без объяснения причины').slice(0,300);delete doc.challenge;event(doc,'declined',now,doc.reason);
  } else if(type==='assistance') {doc.assisted=!!action.value;}
  else fail('Неизвестная операция.');
  doc.updatedAt=now;return {doc,result};
}
export function getMetrics(docs, offers=[], now=Date.now()) {
  const actual=docs.filter(d=>!d.seed);const sent=actual.filter(d=>d.status!=='draft');
  const completed=sent.filter(d=>d.status==='signed');
  // A standalone refusal record represents a separate case; created drafts aren't offered cases yet.
  const cases=sent.length+offers.length;
  return {cases,sent:sent.length,opened:sent.filter(d=>d.events.some(e=>e.type==='viewed')).length,signed:completed.length,independent:completed.filter(d=>!d.assisted).length,assisted:sent.filter(d=>d.assisted).length,earlyRefusals:offers.length,conversion:cases?Math.round(completed.filter(d=>!d.assisted).length/cases*100):null,waiting:sent.filter(d=>effectiveStatus(d,now)==='waiting').length};
}
