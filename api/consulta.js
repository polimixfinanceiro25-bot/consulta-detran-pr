/* ARQUIVO: api/consulta.js (CORRIGIDO COM VALIDAÇÃO) */
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

module.exports = async (req, res) => {
    // Configuração de Segurança (CORS)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { renavam } = req.body;

    if (!renavam) {
        return res.status(400).json({ erro: 'Por favor, informe o Renavam.' });
    }

    try {
        const urlBase = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces';
        const urlAlvo = `${urlBase}/consultar-debitos-detalhes`;

        // --- PASSO 1: Acessar a página para pegar tokens ---
        const responsePagina = await axios.get(urlAlvo);
        
        const cookies = responsePagina.headers['set-cookie'];
        const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

        const $ = cheerio.load(responsePagina.data);
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // Tenta identificar os IDs dinamicamente
        let idCampoRenavam = '';
        $('label').each((i, el) => {
            if ($(el).text().includes('Renavam')) {
                idCampoRenavam = $(el).attr('for');
            }
        });

        let idBotaoConsultar = '';
        $('button, a').each((i, el) => {
            if ($(el).text().includes('Consultar') || $(el).text().includes('Pesquisar')) {
                idBotaoConsultar = $(el).attr('id');
            }
        });

        // IDs de Fallback (Padrão do ADF)
        if (!idCampoRenavam) idCampoRenavam = 'pt1:r1:0:it1'; 
        if (!idBotaoConsultar) idBotaoConsultar = 'pt1:r1:0:b1';

        // --- PASSO 2: Enviar a consulta ---
        const dadosFormulario = {
            'org.apache.myfaces.trinidad.faces.FORM': 'f1',
            'javax.faces.ViewState': viewState,
            'event': idBotaoConsultar,
            [idCampoRenavam]: renavam,
        };

        const responseConsulta = await axios.post(urlAlvo, qs.stringify(dadosFormulario), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieHeader,
                'Origin': 'https://www.contribuinte.fazenda.pr.gov.br',
                'Referer': urlAlvo,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        // --- PASSO 3: Ler e Validar a Resposta ---
        const xml = responseConsulta.data;
        const $xml = cheerio.load(xml, { xmlMode: true });

        const limparTexto = (texto) => texto ? texto.replace(/CDATA\[|\]\]/g, '').trim() : '';

        // Extrai os dados
        const resultado = {
            proprietario: limparTexto($xml('[id*="ot2"]').text()),
            renavam: limparTexto($xml('[id*="ot6"]').text()),
            placa: limparTexto($xml('[id*="ot8"]').text()),
            modelo: limparTexto($xml('[id*="ot10"]').text()),
            ano: limparTexto($xml('[id*="ot12"]').text()),
            debitos: []
        };

        // Extrai valores financeiros
        $xml('span').each((i, el) => {
            const texto = $(el).text();
            if (texto.includes('R$')) {
                resultado.debitos.push(texto.replace('CDATA[', '').replace(']]', '').trim());
            }
        });

        // === AQUI ESTÁ A CORREÇÃO (TRAVA DE SEGURANÇA) ===
        // Se o renavam ou proprietário vierem vazios, significa que o Detran não achou o carro.
        // Então nós forçamos um ERRO para o seu site não abrir a tela em branco.
        if (!resultado.renavam || resultado.renavam === '' || resultado.proprietario === '') {
            return res.status(404).json({ 
                erro: 'Veículo não encontrado. Verifique se o Renavam está correto.' 
            });
        }

        // Se chegou aqui, é porque achou dados reais!
        res.status(200).json(resultado);

    } catch (error) {
        console.error('Erro na API:', error);
        res.status(500).json({ 
            erro: 'Erro de comunicação com o Detran.', 
            detalhes: error.message 
        });
    }
};
