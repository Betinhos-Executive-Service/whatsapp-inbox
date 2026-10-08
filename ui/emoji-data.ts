// Emojis do seletor e do atalho ":texto". Cada linha: emoji + palavras-chave (pt-BR primeiro, depois inglês).
// Ordem e categorias seguem o WhatsApp. São conteúdo da mensagem, não ícones da interface.

export type EmojiCategory = "pessoas" | "natureza" | "comida" | "atividades" | "viagem" | "objetos" | "simbolos" | "bandeiras";
export type Emoji = { char: string; keys: string[]; category: EmojiCategory };

const RAW: Record<EmojiCategory, string> = {
  pessoas: `
😀 sorriso feliz grinning smile
😃 sorriso feliz alegre smiley
😄 sorriso feliz risada smile
😁 sorriso dentes radiante grin
😆 risada rindo laughing
😅 risada suor alivio sweat_smile
🤣 rolando rir gargalhada rofl
😂 chorando rir kkk risada lagrimas joy
🙂 sorriso leve slightly_smiling
🙃 cabeca baixo ironia upside_down
😉 piscadela piscando wink
😊 sorriso corado fofo blush
😇 anjo inocente halo innocent
🥰 apaixonado coracoes amor smiling_hearts
😍 apaixonado olhos coracao heart_eyes
🤩 estrela deslumbrado star_struck
😘 beijo coracao kiss
😗 beijo kissing
😚 beijo olhos fechados kissing_closed
😙 beijo sorriso kissing_smiling
😋 delicia gostoso lingua yum
😛 lingua stuck_out_tongue
😜 lingua piscando brincadeira wink_tongue
🤪 maluco doido zany
😝 lingua olhos fechados squinting_tongue
🤑 dinheiro grana money_mouth
🤗 abraco abracar hug hugging
🤭 risadinha mao boca hand_over_mouth
🤫 silencio segredo shh shushing
🤔 pensando pensativo hmm thinking
🤐 boca fechada ziper zipper
🤨 sobrancelha desconfiado raised_eyebrow
😐 neutro serio neutral
😑 inexpressivo expressionless
😶 sem boca mudo no_mouth
😏 malicioso sorriso de lado smirk
😒 desinteressado entediado unamused
🙄 revirar olhos eye_roll
😬 careta constrangido grimacing
😮‍💨 suspiro alivio exhaling
🤥 mentiroso pinoquio lying
😌 aliviado tranquilo relieved
😔 pensativo triste pensive
😪 sono cansado sleepy
🤤 babando drooling
😴 dormindo sono zzz sleeping
😷 mascara doente mask
🤒 doente febre termometro sick
🤕 machucado ferido bandage
🤢 enjoado nausea nauseated
🤮 vomitando vomit
🤧 espirro gripe sneezing
🥵 calor quente hot
🥶 frio congelando cold
🥴 tonto bebado woozy
😵 tonto confuso dizzy
🤯 cabeca explodindo chocado mind_blown
🤠 caubói cowboy
🥳 festa comemorar aniversario party
😎 oculos escuros legal cool sunglasses
🤓 nerd oculos
🧐 monoculo analisando monocle
😕 confuso confused
😟 preocupado worried
🙁 triste leve slightly_frowning
☹️ triste frowning
😮 surpreso boca aberta open_mouth
😯 espantado hushed
😲 chocado astonished
😳 envergonhado corado flushed
🥺 suplicando por favor pleading
😦 assustado frowning_open
😧 angustiado anguished
😨 medo fearful
😰 ansioso suor anxious
😥 triste aliviado sad_relieved
😢 chorando lagrima triste cry
😭 chorando muito soluco sob
😱 grito medo scream
😖 confuso frustrado confounded
😣 perseverante persevere
😞 desapontado disappointed
😓 suor frio downcast_sweat
😩 exausto cansado weary
😫 cansado tired
🥱 bocejo sono yawning
😤 bufando orgulho triumph
😡 bravo raiva irritado pouting rage
😠 bravo raiva angry
🤬 palavrao xingando cursing
😈 diabinho sorrindo smiling_imp
👿 diabinho bravo imp
💀 caveira morri skull
💩 coco poop
🤡 palhaco clown
👻 fantasma ghost
👽 alien et
🤖 robo robot
😺 gato sorrindo smiley_cat
😹 gato rindo joy_cat
😻 gato apaixonado heart_eyes_cat
🙈 macaco nao vejo see_no_evil
🙉 macaco nao ouco hear_no_evil
🙊 macaco nao falo speak_no_evil
👋 tchau oi aceno mao wave
🤚 mao levantada raised_back_hand
✋ mao parar raised_hand
🖖 vulcano spock
👌 ok perfeito ok_hand
🤌 dedos juntos italiano pinched
🤏 pouquinho pinching
✌️ paz vitoria victory
🤞 dedos cruzados sorte crossed_fingers
🤟 te amo love_you
🤘 rock metal
🤙 me liga ligar call_me
👈 apontar esquerda point_left
👉 apontar direita point_right
👆 apontar cima point_up
👇 apontar baixo point_down
☝️ indicador atencao point_up_2
👍 joinha positivo curti like ok thumbsup
👎 negativo nao curti dislike thumbsdown
✊ punho fist
👊 soco punho punch
🤛 soco esquerda left_fist
🤜 soco direita right_fist
👏 palmas aplausos parabens clap
🙌 maos celebrando oba raised_hands
👐 maos abertas open_hands
🤲 palmas juntas palms_up
🤝 aperto mao acordo negocio handshake
🙏 obrigado por favor rezar amem gratidao pray
✍️ escrevendo writing
💪 forca musculo forte muscle
🧠 cerebro brain
👀 olhos olhando eyes
👁️ olho eye
👄 boca labios lips
👶 bebe baby
🧒 crianca child
👦 menino boy
👧 menina girl
🧑 pessoa adult
👨 homem man
👩 mulher woman
🧓 idoso older
👴 vovo idoso old_man
👵 vovo idosa old_woman
🧑‍💼 executivo escritorio trabalho office_worker
👨‍💼 executivo homem businessman
👩‍💼 executiva mulher businesswoman
🧑‍✈️ piloto pilot
👮 policial police
💂 guarda guard
👷 operario obra construction
🧑‍⚕️ medico saude doctor
🧑‍🍳 cozinheiro chef cook
🧑‍💻 programador computador technologist
🤷 nao sei sei la shrug
🤦 facepalm vergonha alheia
🙋 levantando mao raising_hand
💁 informacao tipping_hand
🙆 ok gesto ok_gesture
🙅 nao gesto no_gesture
🙇 reverencia desculpa bow
🧍 em pe standing
🚶 andando caminhando walking
🏃 correndo pressa running
💃 dancando danca dancer
🕺 dancando man_dancing
👫 casal couple
👪 familia family
🗣️ falando speaking_head
👤 silhueta pessoa bust
`,
  natureza: `
🐶 cachorro cao dog
🐱 gato cat
🐭 rato mouse
🐹 hamster
🐰 coelho rabbit
🦊 raposa fox
🐻 urso bear
🐼 panda
🐨 coala koala
🐯 tigre tiger
🦁 leao lion
🐮 vaca cow
🐷 porco pig
🐸 sapo frog
🐵 macaco monkey
🐔 galinha chicken
🐧 pinguim penguin
🐦 passaro bird
🐤 pintinho chick
🦆 pato duck
🦅 aguia eagle
🦉 coruja owl
🐺 lobo wolf
🐴 cavalo horse
🦄 unicornio unicorn
🐝 abelha bee
🦋 borboleta butterfly
🐌 caracol lesma snail
🐞 joaninha ladybug
🐢 tartaruga turtle
🐍 cobra snake
🐙 polvo octopus
🐠 peixe fish
🐬 golfinho dolphin
🐳 baleia whale
🦈 tubarao shark
🐊 jacare crocodile
🐘 elefante elephant
🦒 girafa giraffe
🐕 cachorro dog2
🐈 gato cat2
💐 buque flores bouquet
🌸 flor cerejeira cherry_blossom
🌹 rosa rose
🌺 hibisco hibiscus
🌻 girassol sunflower
🌼 flor blossom
🌷 tulipa tulip
🌱 broto planta seedling
🌲 pinheiro arvore evergreen
🌳 arvore tree
🌴 palmeira coqueiro praia palm
🌵 cacto cactus
🍀 trevo sorte clover
🍁 folha bordo maple
🍂 folhas outono fallen_leaf
🌍 mundo terra globo earth
🌙 lua moon
⭐ estrela star
🌟 estrela brilhante star2
✨ brilho brilhos sparkles
⚡ raio energia zap
🔥 fogo quente top fire
🌈 arco iris rainbow
☀️ sol sunny
⛅ nublado sol partly_sunny
☁️ nuvem cloud
🌧️ chuva rain
⛈️ tempestade storm
❄️ neve floco snowflake
☃️ boneco neve snowman
💧 gota agua droplet
🌊 onda mar wave_ocean
`,
  comida: `
🍏 maca verde green_apple
🍎 maca vermelha apple
🍐 pera pear
🍊 laranja tangerina orange
🍋 limao lemon
🍌 banana
🍉 melancia watermelon
🍇 uva grapes
🍓 morango strawberry
🍒 cereja cherries
🍑 pessego peach
🥭 manga mango
🍍 abacaxi pineapple
🥥 coco coconut
🥝 kiwi
🍅 tomate tomato
🥑 abacate avocado
🥦 brocolis broccoli
🥕 cenoura carrot
🌽 milho corn
🌶️ pimenta pepper
🥔 batata potato
🍞 pao bread
🥐 croissant
🧀 queijo cheese
🥚 ovo egg
🍳 ovo frito cozinhar cooking
🥓 bacon
🥩 carne bife churrasco meat
🍗 frango coxa poultry
🍔 hamburguer lanche burger
🍟 batata frita fries
🍕 pizza
🌭 cachorro quente hotdog
🥪 sanduiche sandwich
🌮 taco
🌯 burrito
🥗 salada salad
🍝 macarrao espaguete spaghetti
🍜 lamen sopa ramen
🍣 sushi japones
🍱 bento marmita
🍚 arroz rice
🍤 camarao shrimp
🍦 sorvete casquinha ice_cream
🍰 bolo fatia cake
🎂 bolo aniversario birthday
🧁 cupcake
🍫 chocolate
🍬 bala doce candy
🍭 pirulito lollipop
🍩 rosquinha donut
🍪 biscoito cookie
🍿 pipoca popcorn
☕ cafe cafezinho coffee
🍵 cha tea
🧃 suco juice
🥤 refrigerante copo soda
🍺 cerveja chopp beer
🍻 brinde cervejas beers
🥂 brinde taca champanhe cheers
🍷 vinho wine
🥃 whisky dose tumbler
🍸 drink coquetel cocktail
🍹 drink tropical tropical
🍾 champanhe garrafa champagne
🧊 gelo ice
🍽️ prato talheres refeicao plate
🍴 garfo faca talheres fork_knife
`,
  atividades: `
⚽ futebol bola soccer
🏀 basquete basketball
🏈 futebol americano football
⚾ beisebol baseball
🎾 tenis tennis
🏐 volei volleyball
🏓 pingue pongue ping_pong
🥊 boxe luva boxing
🥋 artes marciais judo
⛳ golfe golf
🎣 pesca fishing
🏊 natacao nadando swimming
🚴 ciclismo bicicleta cycling
🏋️ academia peso musculacao weight
🧘 yoga meditacao yoga
🏆 trofeu campeao vitoria trophy
🥇 medalha ouro primeiro gold
🥈 medalha prata segundo silver
🥉 medalha bronze terceiro bronze
🏅 medalha medal
🎖️ condecoracao military_medal
🎗️ fita lembrete reminder_ribbon
🎫 ingresso ticket
🎟️ ingressos tickets
🎪 circo circus
🎭 teatro theater
🎨 arte pintura art
🎬 cinema filme clapper
🎤 microfone cantar karaoke microphone
🎧 fone musica headphones
🎼 partitura music_score
🎹 piano teclado piano
🥁 bateria tambor drum
🎷 saxofone sax
🎺 trompete trumpet
🎸 guitarra violao guitar
🎻 violino violin
🎲 dado jogo dice
♟️ xadrez chess
🎯 alvo meta objetivo dart
🎳 boliche bowling
🎮 videogame controle game
🧩 quebra cabeca puzzle
🎉 festa comemoracao parabens tada
🎊 confete festa confetti
🎈 balao aniversario balloon
🎁 presente gift
🎄 natal arvore christmas
🎆 fogos ano novo fireworks
`,
  viagem: `
🚗 carro automovel car
🚙 suv carro utilitario suv
🚕 taxi
🚘 carro chegando oncoming_car
🚐 van minivan
🚌 onibus bus
🚎 trolebus trolleybus
🏎️ carro corrida race_car
🚓 viatura policia police_car
🚑 ambulancia ambulance
🚒 bombeiros fire_engine
🚚 caminhao entrega truck
🛻 picape pickup
🏍️ moto motocicleta motorcycle
🛵 scooter lambreta
🚲 bicicleta bike
🛴 patinete scooter_kick
🚨 sirene alerta rotating_light
🚦 semaforo farol traffic_light
🛑 pare stop
🚧 obra construcao construction_sign
⛽ combustivel posto gasolina fuel
🅿️ estacionamento parking
🛣️ rodovia estrada motorway
🗺️ mapa map
📍 local localizacao pin endereco round_pushpin
🧭 bussola compass
✈️ aviao voo airplane
🛫 decolagem partida embarque departure
🛬 pouso chegada desembarque arrival
🚁 helicoptero helicopter
🚀 foguete rocket
🚢 navio ship
⛴️ balsa ferry
🚤 lancha speedboat
🚆 trem train
🚇 metro subway
🏠 casa house
🏡 casa jardim house_garden
🏢 predio escritorio empresa office
🏨 hotel
🏥 hospital
🏦 banco bank
🏫 escola school
🏪 loja conveniencia store
🏬 shopping department_store
⛪ igreja church
🏟️ estadio stadium
🏖️ praia guarda sol beach
🏝️ ilha island
⛰️ montanha mountain
🌃 cidade noite night
🌆 cidade entardecer cityscape
🌅 nascer do sol sunrise
🗽 estatua liberdade nova york liberty
🗼 torre tower
🎡 roda gigante ferris_wheel
🧳 mala bagagem luggage
⌛ ampulheta hourglass
⏰ despertador alarme alarm_clock
⏱️ cronometro stopwatch
🕐 relogio hora clock
`,
  objetos: `
⌚ relogio pulso watch
📱 celular telefone smartphone
💻 notebook computador laptop
🖥️ computador desktop
⌨️ teclado keyboard
🖨️ impressora printer
📷 camera foto camera
📹 filmadora video
📞 telefone ligacao phone
☎️ telefone fixo telephone
📠 fax
📺 televisao tv
🔋 bateria battery
🔌 tomada plug
💡 lampada ideia bulb
🔦 lanterna flashlight
🕯️ vela candle
💸 dinheiro voando gasto money_wings
💵 dinheiro nota dolar dollar
💰 saco dinheiro money_bag
💳 cartao credito card
🧾 recibo nota fiscal receipt
💎 diamante joia gem
⚖️ balanca justica scale
🔧 chave inglesa ferramenta wrench
🔨 martelo hammer
🛠️ ferramentas tools
⚙️ engrenagem config gear
🔩 parafuso porca nut_bolt
🧰 caixa ferramentas toolbox
🔑 chave key
🗝️ chave antiga old_key
🔒 cadeado fechado lock
🔓 cadeado aberto unlock
🚪 porta door
🛋️ sofa couch
🛏️ cama bed
🚿 chuveiro shower
🧴 locao lotion
🧹 vassoura limpeza broom
🧺 cesto basket
🛒 carrinho compras cart
🎒 mochila backpack
👔 gravata camisa social necktie
👕 camiseta shirt
👖 calca jeans
👗 vestido dress
👠 salto alto heel
👟 tenis sneaker
👞 sapato shoe
👓 oculos glasses
🕶️ oculos escuros dark_sunglasses
💼 maleta pasta trabalho briefcase
👜 bolsa handbag
☂️ guarda chuva umbrella
💍 anel alianca ring
💄 batom lipstick
📦 caixa pacote encomenda package
📫 caixa correio mailbox
✉️ envelope carta email
📧 email e-mail
📨 mensagem recebida incoming_envelope
📩 envelope seta envelope_arrow
📝 anotacao memo nota memo
📄 documento pagina page
📃 pagina curvada page_curl
📑 marcadores bookmark_tabs
📊 grafico barras bar_chart
📈 grafico subindo alta chart_up
📉 grafico caindo baixa chart_down
📋 prancheta clipboard
📅 calendario data calendar
📆 calendario agenda date
🗓️ agenda espiral spiral_calendar
📌 tachinha fixar pushpin
📎 clipe anexo paperclip
✂️ tesoura scissors
🖊️ caneta pen
✏️ lapis pencil
🔍 lupa procurar search
📚 livros books
📖 livro aberto book
🔖 marcador bookmark
🏷️ etiqueta label
🔔 sino notificacao bell
🔕 sem som mudo no_bell
📢 megafone aviso loudspeaker
📣 megafone mega
💬 balao fala conversa speech
💭 pensamento balao thought
🗯️ balao raiva anger_bubble
💊 remedio comprimido pill
💉 seringa vacina syringe
🩺 estetoscopio stethoscope
🎀 laco ribbon
🪑 cadeira chair
`,
  simbolos: `
❤️ coracao vermelho amor heart
🧡 coracao laranja orange_heart
💛 coracao amarelo yellow_heart
💚 coracao verde green_heart
💙 coracao azul blue_heart
💜 coracao roxo purple_heart
🖤 coracao preto black_heart
🤍 coracao branco white_heart
🤎 coracao marrom brown_heart
💔 coracao partido broken_heart
❣️ exclamacao coracao heart_exclamation
💕 dois coracoes two_hearts
💞 coracoes girando revolving_hearts
💓 coracao batendo heartbeat
💗 coracao crescendo heartpulse
💖 coracao brilhante sparkling_heart
💘 coracao flecha cupido cupid
💝 coracao presente gift_heart
💯 cem 100 perfeito hundred
💢 raiva anger
💥 explosao boom
💫 tonto estrelas dizzy_star
💦 gotas suor sweat_drops
💨 vento rapido dash
💤 sono zzz
✅ certo feito concluido check
☑️ caixa marcada ballot_check
✔️ visto check_mark
❌ errado x cancelar cross
❎ x quadrado cross_mark_button
➕ mais adicionar plus
➖ menos minus
➗ dividir divide
✖️ vezes multiply
❓ pergunta duvida question
❔ pergunta branca grey_question
❗ exclamacao importante exclamation
‼️ dupla exclamacao bangbang
⁉️ exclamacao pergunta interrobang
⚠️ atencao aviso cuidado warning
🚫 proibido prohibited
⛔ entrada proibida no_entry
🔞 maiores 18 underage
♻️ reciclar recycle
🆗 ok botao ok_button
🆕 novo new
🆓 gratis free
🆘 socorro sos
🔴 circulo vermelho red_circle
🟠 circulo laranja orange_circle
🟡 circulo amarelo yellow_circle
🟢 circulo verde green_circle
🔵 circulo azul blue_circle
🟣 circulo roxo purple_circle
⚫ circulo preto black_circle
⚪ circulo branco white_circle
🟥 quadrado vermelho red_square
🟩 quadrado verde green_square
🟦 quadrado azul blue_square
🔺 triangulo vermelho red_triangle
🔻 triangulo baixo red_triangle_down
🔸 losango laranja orange_diamond
🔹 losango azul blue_diamond
▶️ play tocar play
⏸️ pausa pause
⏹️ parar stop_button
⏩ avancar fast_forward
⏪ voltar rewind
🔁 repetir repeat
🔄 atualizar sincronizar arrows_counterclockwise
⬆️ seta cima up
⬇️ seta baixo down
⬅️ seta esquerda left
➡️ seta direita right
↩️ voltar retornar leftwards_arrow
🔝 topo top
🔜 em breve soon
🔙 voltar back
🕒 tres horas three_oclock
#️⃣ hashtag numero hash
*️⃣ asterisco asterisk
0️⃣ zero
1️⃣ um 1 one
2️⃣ dois 2 two
3️⃣ tres 3 three
4️⃣ quatro 4 four
5️⃣ cinco 5 five
6️⃣ seis 6 six
7️⃣ sete 7 seven
8️⃣ oito 8 eight
9️⃣ nove 9 nine
🔟 dez 10 ten
©️ copyright
®️ registrado registered
™️ marca registrada tm
ℹ️ informacao info
🔅 brilho baixo dim
🔆 brilho alto bright
📶 sinal antena signal
📵 sem celular no_phones
🔇 mudo mute
🔊 som alto volume speaker
`,
  bandeiras: `
🏁 bandeira quadriculada chegada checkered_flag
🚩 bandeira vermelha triangular_flag
🏳️ bandeira branca white_flag
🏳️‍🌈 bandeira arco iris orgulho rainbow_flag
🇧🇷 brasil br brazil
🇵🇹 portugal pt
🇺🇸 eua estados unidos usa us
🇦🇷 argentina ar
🇨🇱 chile cl
🇺🇾 uruguai uy
🇵🇾 paraguai py
🇨🇴 colombia co
🇲🇽 mexico mx
🇨🇦 canada ca
🇬🇧 reino unido inglaterra uk gb
🇫🇷 franca fr france
🇩🇪 alemanha de germany
🇮🇹 italia it italy
🇪🇸 espanha es spain
🇯🇵 japao jp japan
🇨🇳 china cn
🇪🇺 uniao europeia eu
`,
};

export const EMOJI_CATEGORIES: { id: EmojiCategory; label: string }[] = [
  { id: "pessoas", label: "Smileys e pessoas" },
  { id: "natureza", label: "Animais e natureza" },
  { id: "comida", label: "Comidas e bebidas" },
  { id: "atividades", label: "Atividades" },
  { id: "viagem", label: "Viagens e lugares" },
  { id: "objetos", label: "Objetos" },
  { id: "simbolos", label: "Símbolos" },
  { id: "bandeiras", label: "Bandeiras" },
];

export const EMOJIS: Emoji[] = EMOJI_CATEGORIES.flatMap(({ id }) =>
  RAW[id]
    .trim()
    .split("\n")
    .map((line) => {
      const [char, ...keys] = line.trim().split(/\s+/);
      return { char, keys, category: id };
    }),
);
