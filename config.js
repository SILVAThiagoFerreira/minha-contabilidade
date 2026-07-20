// Configuração opcional do modo online.
// O modo local protegido funciona sem nenhuma configuração e não envia dados para a rede.
window.FINANCE_CONFIG = Object.freeze({
  apiUrl: "",
  // Client ID web não é segredo. O endpoint só será ativado depois que o
  // Web App do Apps Script for autorizado e a URL /exec for validada.
  googleClientId: "778703180705-mb55aqm7573p8eh9vsoetbbl1v1g7jl1.apps.googleusercontent.com"
});
