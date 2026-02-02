/* ARQUIVO: api/consulta.js
   OBJETIVO: Realizar a consulta de débitos no Detran-PR via Vercel
   AUTOR: Gemini (Assistente) para Projeto Acadêmico de Segurança da Informação
*/

const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

module.exports = async (req, res) => {
    // 1. Configuração de Segurança (CORS)
    // Permite que seu index.html converse com este backend
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Responde rápido se o navegador só estiver testando a conexão
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Recebe o Renavam do seu site
    const { renavam } = req.body;

    if (!renavam) {
        return res.status(400).json({ erro: 'Por favor, informe o Renavam.' });
    }

    try {
        // URLs oficiais (Alvos da consulta)
        const urlBase = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces';
        const urlAlvo = `${urlBase}/consultar-debitos-detalhes`; // URL que vimos no print

        // --- PASSO 1: O "Handshake" (Aperto de mão) ---
        // Acessamos a página inicial para pegar o "Crachá" (Cookie) e o "Mapa" (ViewState)
        // Sem isso, o servidor bloqueia a conexão.
        
        const responsePagina = await axios.get(urlAlvo);
        
        // Captura os Cookies de sessão (JSESSIONID)
        const cookies = responsePagina.headers['set-cookie'];
        const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

        // Carrega o HTML da página para ler os códigos escondidos
        const $ = cheerio.load(responsePagina.data);
        
        // Pega o Token de segurança obrigatório (javax.faces.ViewState)
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // --- TÉCNICA DE SEGURANÇA: Web Scraping Dinâmico ---
        // Em vez de chutar o ID do campo (que pode mudar), procuramos ele pelo rótulo.
        
        // 1. Procura o Label que contem "Renavam"
        let idCampoRenavam = '';
        $('label').each((i, el) => {
            if ($(el).text().includes('Renavam')) {
                idCampoRenavam = $(el).attr('for'); // Pega o ID do input ligado a este label
            }
        });

        // 2. Procura o botão de "Consultar" para simular o clique
        let idBotaoConsultar = '';
        $('button, a').each((i, el) => {
            if ($(el).text().includes('Consultar') || $(el).text().includes('Pesquisar')) {
                idBotaoConsultar = $(el).attr('id');
            }
        });

        // Fallback: Se não achar dinamicamente, tenta um ID padrão comum no ADF (arriscado, mas necessário)
        if (!idCampoRenavam) idCampoRenavam = 'pt1:r1:0:it1'; 
        if (!idBotaoConsultar) idBotaoConsultar = 'pt1:r1:0:b1';

        console.log(`Configuração detectada -> Campo: ${idCampoRenavam}, Botão: ${idBotaoConsultar}`);

        // --- PASSO 2: A Consulta Real (Payload) ---
        // Montamos o pacote de dados exatamente como o site espera (visto no seu print)
        
        const dadosFormulario = {
            'org.apache.myfaces.trinidad.faces.FORM': 'f1', // Nome padrão do formulário ADF
            'javax.faces.ViewState': viewState,
            'event': idBotaoConsultar, // Dizemos ao servidor "Cliquei neste botão"
            [idCampoRenavam]: renavam, // Preenchemos o Renavam dinamicamente
        };

        // Envia a requisição POST (Simulando o clique do usuário)
        const responseConsulta = await axios.post(urlAlvo, qs.stringify(dadosFormulario), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieHeader,
                'Origin': 'https://www.contribuinte.fazenda.pr.gov.br',
                'Referer': urlAlvo,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        // --- PASSO 3: O Parser (Limpeza dos Dados) ---
        // O servidor devolve aquele XML sujo. Aqui nós limpamos e extraímos o ouro.
        
        const xml = responseConsulta.data;
        const $xml = cheerio.load(xml, { xmlMode: true });

        // Função auxiliar para limpar o texto extraído
        const limparTexto = (texto) => texto ? texto.replace(/CDATA\[|\]\]/g, '').trim() : 'Não encontrado';

        // Extração baseada nos IDs que vimos no seu XML de resposta
        // Nota: Se o site mudar os IDs (ot6, ot8), precisaremos atualizar aqui.
        const resultado = {
            proprietario: limparTexto($xml('[id*="ot2"]').text()), // Busca qualquer ID que tenha 'ot2' (Nome)
            renavam: limparTexto($xml('[id*="ot6"]').text()),     // Renavam
            placa: limparTexto($xml('[id*="ot8"]').text()),       // Placa
            modelo: limparTexto($xml('[id*="ot10"]').text()),     // Modelo
            ano: limparTexto($xml('[id*="ot12"]').text()),        // Ano
            debitos: []
        };

        // Verifica se encontrou débitos (Valor total ou lista)
        // Procura por campos que tenham formato de dinheiro (R$)
        $xml('span').each((i, el) => {
            const texto = $(el).text();
            if (texto.includes('R$')) {
                resultado.debitos.push(texto.replace('CDATA[', '').replace(']]', '').trim());
            }
        });

        // Retorna o JSON limpo para o seu site
        res.status(200).json(resultado);

    } catch (error) {
        console.error('Erro na API:', error);
        res.status(500).json({ 
            erro: 'Falha ao consultar o Detran.', 
            detalhes: error.message 
        });
    }
};