import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Button, SafeAreaView, StyleSheet, Text, TextInput, View, Alert, FlatList, 
    TouchableOpacity,Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import WebView from 'react-native-webview';
import * as DocumentPicker from 'expo-document-picker';

import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as Permissions from 'expo-permissions';


// const RCTNetworking = require('react-native/Libraries/Network/RCTNetworking')
const cheerio = require('cheerio')

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const AlunoContext = React.createContext();


const config = {
    // "user-agent": "uvv-mobile-2",
    "body": null,
    "method": "GET" 
};


function extract_nome_professor(materia) {
    return materia.find('.nome-professor').text().trim().split(',')[0]
}

function parse_materia_hibrida(materia) {
    let turma_disciplina = materia.find('.h3').text().trim();

    // alerta de provas
    let prova_local; 
    let prova_data;
    let alert = materia.find('.alert') 
    if (alert.length > 0){
        let foo = alert.text().trim().split('\n')[1];
        let matches = /Local de Prova:(.+)Data da Prova:(.+)/gm.exec(foo);
        prova_local = matches[1];
        prova_data = matches[2];
    }

    return {
        "disciplina":       turma_disciplina.slice(7),
        "tipo":             "normal",
        "turma":            turma_disciplina.slice(0, 4),
        "professor":        extract_nome_professor(materia),
        "blog_id":          materia.find('a').eq(1).attr('href').slice(24),
        "prova_agendada":   (alert.length == 0) ? null : {
            "local": prova_local,
            "data": prova_data, // "DD/MM/YYYY HH:MM"
        },
    };
}

function parse_materia_normal(materia) {
    let turma_disciplina = materia.find('h3').text().trim();
    return {
        "disciplina":       turma_disciplina.slice(7),
        "tipo":             "hibrida",
        "turma":            turma_disciplina.slice(0, 4),
        "professor":        extract_nome_professor(materia),
        "blog_id":          materia.find('a').attr('href').slice(24),
        "prova_agendada":   null,
    };
}

async function extract_blog_page(materia, blog_page) {
    // "https://aluno.uvv.br/Aluno/Blog/?parametros="

    let blog_link = "https://aluno.uvv.br/Aluno/BlogCarregarMais/?parametros=" 
        + materia.blog_id + "&pageSize=3&pageNumber=" + blog_page;

    let response = await fetch(blog_link, config);
    let html = await response.text();

    const $ = cheerio.load(html); 
    let page = [];
    $('.timeline-inverted').each((index, element) => {
        index = index;
        let materia = $(element);

        //<div class='fa fa fa-envelope-on'> -> 'envelope'
        let badge = materia.find('.timeline-badge > .fa') 
            .attr('class')
            .split(' ')
            .slice(-1)[0]
            .split('-')[1]

        page.push({
            "data":     materia.find('.timeline-date').text(),
            "tipo":     badge,
            "titulo":   materia.find('.panel-title').text(),
            "id":       "https://aluno.uvv.br" + materia.find('a').last().attr('href'),
            "body":     materia.find('.panel-body').html().trim(),
        });

    });

    return page;
}

async function extract_fullpost(post) {

    let response = await fetch(post.id, config)
    let html = await response.text();

    const $ = cheerio.load(html);

    let comentarios = []
    $('.box-conversas').each((index, element) => {
        index = index;
        let box_conversa = $(element);
        comentarios.push({
            "nome": box_conversa.find('h4').text(),
            "data": box_conversa.find('span').text(),
            "mensagem": box_conversa.find('.txt-conversa').text().trim(),
        });
    });

    let arquivos = []
    $('.box-atividades-content > a').each((index, element) => {
        index = index;
        let box_atividades = $(element);
        arquivos.push({
            "nome": box_atividades.attr('title'),
            "link": "https://aluno.uvv.br" + box_atividades.attr('href'),
        });
    });

    return {
        "tipo": post.tipo,
        "prazo": $('h4 > strong').eq(1).text(),
        "arquivos": arquivos,
        "comentarios": comentarios,
        "body": $('.panel-body').html().trim(),
    };
}


async function extract_materias() {
    let materias = [];

    let response = await fetch("https://aluno.uvv.br/Aluno/MinhasTurmas", config)
    let html = await response.text()

    const $ = cheerio.load(html);

    if ($('.login-screen').length > 0) {
        throw new Error("login necessario");
    }

    $('.card-turma').each((index, element) => {
        index = index;
        let materia = $(element);

        if (materia.find('h3').length == 1) {
            materias.push(parse_materia_normal(materia));
        } 
        else if (materia.find('.h3').length == 1) { 
            materias.push(parse_materia_hibrida(materia));
        }
    });

    let aluno_id = $('#side-menu > li:nth-child(12) > a')
        .attr('href')
        .split('/')
        .slice(-1)[0]

    let nome = $('#side-menu > li.perfil-aluno > div:nth-child(2) > p')
        .text()
        .trim()

    let matricula = $('#side-menu > li.perfil-aluno > div:nth-child(3) > p')
        .text()
        .split(':')[1]
        .trim()

    let curso_horario = $('#side-menu > li.perfil-aluno > div:nth-child(4) > div')
        .text()
        .split('-')


    let aluno_info = {
        id: aluno_id,
        nome: nome,
        matricula: matricula,
        curso: curso_horario[0].trim(),
        horario: curso_horario[1].trim(),
        
    }

    return [materias, aluno_info];
}

async function extract_boletim(aluno_id) {

    let response = await fetch("https://aluno.uvv.br/Boletim/Aluno/" + aluno_id.id, config)
    const html = await response.text();
    const $ = cheerio.load(html);

    const table_select = 'table > tbody > tr';

    const column = [ "periodo", "turma", "disciplina", "av1", "tf1", 
        "av2", "tf2", "mp", "pf", "tf", "final", "resultado" ]

    // console.log(html);
    let notas = [];
    $(table_select).each((_, row) => {
        let materia = {};
        $(row).find('td').each((index, element) => {
            const item = $(element).text().trim();
            materia[column[index]] = item == "-" ? "" : item;
        });
        notas.push(materia);
    });
    return notas;
}



const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1a1a1a',
        padding: 10,
    },
    border: {
        borderRadius: 4,
    },
    materia: {
        flex: 1,
        padding: 10,
        margin: 10,
        marginHorizontal: 3,
        backgroundColor: '#2a2a2a',
        borderRadius: 4,
    },
    separate: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    text: {
        color: 'white',
    },
    mini: {
        color: 'white',
        fontSize: 12,
    },
    href: {
        color: 'lightblue',
    },
    h1: {
        color: 'white',
        fontSize: 21,
    },
    h2: {
        color: 'white',
        fontSize: 18,
    },
    log: {
        color: 'white',
        backgroundColor: '#2a2a2a',
        padding: 15,
        fontFamily: 'monospace',
        fontSize: 10,
    },
    button: {
        elevation: 10,
        backgroundColor: 'purple',
        float: 'right',
    },
    input: {
        height: 40,
        margin: 12,
        borderWidth: 1,
        padding: 10,
        color: 'white',
        borderColor: 'white',
    },
    filesComments: {
        marginTop: 20,
        marginBottom: 20,
        backgroundColor: "#333333",
        padding: 8,
    },
});




let Comment = ({comment}) => {
    return (
        <View style={{marginTop: 10, marginBottom: 10, padding: 10, backgroundColor: "#222222"}}>
            <Text style={styles.text}>{comment.nome} </Text>
            <Text style={styles.text}>{comment.data} </Text>
            <Text style={styles.text}>{comment.mensagem} </Text>
        </View>
    )
}

let CommentSection = ({comments}) => {
    return (
        <View style={styles.filesComments}>
            <Text style={styles.h2}>Comentarios: </Text>
            {(comments.length > 0) ?
                <FlatList
                    data={comments}
                    renderItem={(comment) => 
                        <Comment comment={comment.item} /> 
                    }
                    nestedScrollEnabled
                />
                : <Text style={styles.text}>nenhum comentario</Text>
            }
        </View>
    )
}

let File = ({file}) => {
    return (
        <View style={{marginTop: 10, marginBottom: 10, padding: 10, backgroundColor: "#222222"}}>
            <Text style={styles.text}>{file.nome} </Text>
            <TouchableOpacity onPress={async() => { 
                // Linking.openURL(file.link);
                try {
                    let fileUri = FileSystem.documentDirectory + file.nome;
                    const { uri } = await FileSystem.downloadAsync(
                        file.link, 
                        fileUri
                    );
                    console.log(uri);
                    console.log( FileSystem.cacheDirectory);

                    const { status } = await Permissions.askAsync(Permissions.CAMERA_ROLL);
                    if ( status == "granted" ) {
                        const asset = await MediaLibrary.createAssetAsync(fileUri);
                        await MediaLibrary.createAlbumAsync("Download", asset, false);
                    }
                }
                catch (error) {
                    console.error(error);
                }
            }}>
                <Text style={styles.href}> Baixar arquivo </Text>
            </TouchableOpacity>
        </View>
    )
}

let FileSection = ({files, shortpost}) => {
    console.log(shortpost.id);

    const [ fileSelected, setFileSelected ] = useState(null);

    const uploadImage = async () => {
        const data = new FormData();
        data.append('temArquivo', true);
        data.append('arquivo', fileSelected.uri);

        let res = await fetch(shortpost.id,
            {
                method: 'shortpost',
                body: data,
                headers: {
                    'Content-Type': 'multipart/form-data; ',
                },
            }
        );
        let response = await res.text();
        console.log(response);
    };

    let selectFile = async () => {
        try {
            const res = await DocumentPicker.getDocumentAsync();
            console.log(res);
            setFileSelected(res);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <View style={styles.filesComments}>
            <Text style={styles.h2}>Arquivos:</Text>
            <FlatList
                data={files}
                renderItem={(file) => <File file={file.item}/> }
            />
            {
                shortpost.tipo == "pencil" && 
                <Button title="enviar arquivo" onPress={selectFile} />
            }
        </View>
    )

}

let FullPost = ({navigation, route}) => {
    navigation = navigation;

    let [ fullpost, setFullpost] = useState(null);
    let [ showWebView, setShowWebView] = useState(true);
    let shortpost = route.params.shortpost;

    useEffect(() => { 
        (async () => {
            let fullpost_json = await extract_fullpost(shortpost)
            setFullpost(fullpost_json);

            let cleaned = fullpost_json.body.replace(/<\/?\w+>/g, "");

            if (cleaned.replace(/^\s*$/g, "").length == 0) {
                console.log("webview vazio");
                setShowWebView(false);
                return
            }
        })()
    }, [setFullpost]);

    // style={{backgroundColor: '#1a1a1a'}}
    return (
        <View style={styles.container}>
            <View style={styles.separate}>
                <Text></Text>
                <TouchableOpacity
                    onPress={() => Linking.openURL(shortpost.id)}>
                    <Text style={[styles.mini, styles.href]}>Abrir no site </Text>
                </TouchableOpacity>
            </View>
            {
                !fullpost ? 
                 <Text style={styles.text}>carregando...</Text>
                : <SafeAreaView style={{flex: 1}}>
                    <Text style={styles.h1}>{shortpost.titulo} </Text>
                    <Text style={styles.h2}>Enviado: {shortpost.data} </Text>
                    {
                        fullpost.prazo && <Text style={styles.h2}>Prazo: {fullpost.prazo} </Text>
                    }
                    <Text style={styles.text}>{fullpost.tipo} </Text>
                    { 
                        !showWebView ? 
                        <Text style={styles.mini}>nenhuma mensagem a ser mostrada </Text>
                        : <WebView
                            originWhitelist={["https://aluno.uvv.br/*"]}
                            source={{ html: fullpost.body}}
                            containerStyle={styles.border}
                            onShouldStartLoadWithRequest={(request) => {
                                // Only allow navigating within this website
                                return request.url.startsWith("https://aluno.uvv.br");
                                // não funciona?
                            }}
                            scalesPageToFit={false}
                        />
                    }
                    {
                        (fullpost.arquivos || shortpost.tipo == "pencil") && 
                            <FileSection files={fullpost.arquivos} shortpost={shortpost}/> 
                    }
                    { // posts com comentarios bloqueando o webview
                        fullpost.comentarios  && <CommentSection comments={fullpost.comentarios} /> 
                    }
                </SafeAreaView>
            }
            <StatusBar style="auto" />
        </View>
    );
};



let BlogPages = ({navigation, route}) => {

    let [page, setPage] = useState([]);
    let [next_page_index, setNextPage] = useState(0);
    let [loading, setLoading] = useState(false);
    let [max_page_reached, setMaxPageReached] = useState(false);
    let [footer_button_title, setFooterButtonTitle] = useState("carregar mais");

    const ShortPost = ({post}) => {
        return (
            <View style={styles.materia}>
                <Text style={styles.text}>{post.titulo} </Text>
                <Text style={[styles.text, {backgroundColor: "red", maxWidth: "10%"}]}>{post.tipo} </Text>
                <Text style={styles.text}>{post.data} </Text>
                <Button 
                    title="visualizar"
                    disabled={loading}
                    onPress={() => {
                        navigation.navigate("FullPost", { shortpost: post });
                    }}
                    color="#3b2691"
                />
            </View>
        )
    };

    async function  update_blog_page() {
        setLoading(true);
        setFooterButtonTitle("carregando...");
        let old_pages = [...page];

        let new_page = await extract_blog_page(route.params.materia, next_page_index);

        if (new_page.length == 0) {

            setMaxPageReached(true);
            setLoading(false);
            setFooterButtonTitle("sem mais paginas");
            return
        }
        // console.log(next_page_index);

        setNextPage(next_page_index + 1);
        setPage(old_pages.concat(new_page));
        setMaxPageReached(false);
        setLoading(false);
        setFooterButtonTitle("carregar mais");
    }

    useEffect(() => { update_blog_page() }, [setPage]);

    return (
        <SafeAreaView style={[styles.container, {padding: 0}]}>
            <View style={{margin: 20, marginBottom: 0}}>
                <Text style={styles.h1}>{route.params.materia.professor}</Text>
                <Text style={styles.h2}>{route.params.materia.disciplina}</Text>
            </View>
            { !(page == []) ? 
                <FlatList
                    data={page}
                    renderItem={(shortpost) => <ShortPost post={shortpost.item}/>}
                />
                : <Text style={styles.text}>carregando...</Text> }
            <Button sytle={styles.button} 
                disabled={max_page_reached || loading}
                onPress={update_blog_page} 
                color="#3b2691"
                title={footer_button_title}/>
            <StatusBar style="auto" />
        </SafeAreaView>
    );

};


const ProvaAgendada = ({materia}) => {
    const [showProvaAgendada, setProvaAgendada] = useState(false);
    return (
        <TouchableOpacity 
            onPress={() => showProvaAgendada ? 
                setProvaAgendada(false) : setProvaAgendada(true)}
            style={ { backgroundColor: '#990101', padding: 10 }}
        >
            <Text style={styles.h2}>Prova Agendada{showProvaAgendada && ':'}</Text>
            {
                showProvaAgendada && 
                <View>
                    <Text style={styles.text}>Local: </Text>
                    <Text style={styles.mini}>{materia.prova_agendada.local} </Text>
                    <Text style={styles.text}>Data:</Text>
                    <Text style={styles.mini}>{materia.prova_agendada.data} </Text>
                </View>
            }
        </TouchableOpacity>
    )
}

const Materia = ({materia, navigation}) => {
    return (
        <View style={styles.materia}>
            <View style={{marginBottom: 20}}>
                <Text style={styles.h2}>{materia.disciplina} </Text>
                <Text style={styles.text}>{materia.professor} </Text>
                <View style={styles.separate}>
                <Text style={styles.mini}>{materia.turma} </Text>
                <Text style={styles.mini}>{materia.tipo} </Text>
                </View>
            </View>
            <Button title="blog" 
                onPress={() => {
                    navigation.navigate("BlogPages", { materia: materia });
                }}
                color="#3b2691"/>
            { 
                materia.prova_agendada && <ProvaAgendada materia={materia}/>
            }
        </View>
    )
}

let Main = ({navigation}) => { 

    const { materias } = React.useContext(AlunoContext);

    return (
        <View style={styles.container}>
            <SafeAreaView>
                <FlatList
                    data={materias}
                    renderItem={(materia) => <Materia materia={materia.item} navigation={navigation}/> }
                    nestedScrollEnabled >
                </FlatList>
            </SafeAreaView>
            <StatusBar style="auto" />
        </View>
    );

}

let Login = ({navigation}) => {

    const [username, onChangeUsername] = React.useState('');
    const [password, onChangePassword] = React.useState('');

    async function authenticate() {
        // limpar cookies
        // RCTNetworking.clearCookies(() => { })

        onChangePassword('');

        // enviar formulario
        let body = "Matricula=" + encodeURIComponent(username) 
            + "&Password=" + encodeURIComponent(password);
        let response = await fetch("https://aluno.uvv.br/", {
            "headers": {
                "cache-control": "no-cache",
                "content-type": "application/x-www-form-urlencoded; ",
                "pragma": "no-cache",
                "sec-ch-ua-mobile": "?1",
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-origin",
                "sec-fetch-user": "?1",
                "upgrade-insecure-requests": "1",
                "Referer": "https://aluno.uvv.br/",
                "Referrer-Policy": "strict-origin-when-cross-origin"
            },
            "body": body,
            "method": "POST"
        });
        let html = await response.text();

        const $ = cheerio.load(html);
        // login falhou caso a pagina inicial tenha sido retornada
        if ($('.login-parallax').length == 1) {
            return false;
        }

        return true;
    }

    return (
        <View style={styles.container}>
            <StatusBar style="auto" />
            <SafeAreaView>
                <Text style={styles.text}>matricula</Text>
                <TextInput style={styles.input}
                    onChangeText={onChangeUsername}
                    value={username}
                />
                <Text style={styles.text}>senha</Text>
                <TextInput style={styles.input}
                    onChangeText={onChangePassword}
                    value={password}
                    secureTextEntry={true} 
                />
            </SafeAreaView>
        <Button sytle={styles.button} title="entrar" onPress={() => {
            if (authenticate()) {
                navigation.navigate("Feed");
            } else {
                console.log("autheticantion error");
                Alert.alert( '', 'Login Incorreto', [{ text: 'OK', }]);
            }
        }} />

        </View>
    )
}


let MateriaStack = () => {
    return (
        <Stack.Navigator
            initialRouteName='Main'
        screenOptions={{headerShown: false}}
        >
            <Stack.Screen
                name="Main"
                component={Main}
                options={{title: "Matérias"}}
            />
            <Stack.Screen
                name="BlogPages"
                component={BlogPages}
                options={{title: "Blog"}}
            />
            <Stack.Screen
                name="FullPost"
                component={FullPost}
                options={{title: "Postagem"}}
            />
        </Stack.Navigator>
    )
}

const Loading = () => {
    return (
        <View> 
            <Text style={styles.text}>carregando...</Text> 
        </View>
    );
}

const Boletim = () => {

    const { alunoInfo } = React.useContext(AlunoContext);
    const [ notas, setNotas ] = useState(null);

    const NotaAvaliacao = ({avaliacao, nota}) => {
        return (
            <View>
                <Text style={styles.h2}>{avaliacao}: {'\t'}{ nota ? nota : "n/a" } </Text> 
            </View>
        )
    }
    const MateriaBoletim = ({notas}) => {

        const [show, setShow] = useState(false);
        return (
            <TouchableOpacity style={styles.materia}
                onPress={() => show ? 
                    setShow(false) : setShow(true)}
            >
                <Text style={styles.h2}> { notas.disciplina } ({notas.periodo} - {notas.turma}) </Text>
                { show && 
                    <View>
                        <NotaAvaliacao avaliacao="AV1" nota={ notas.av1 }/>
                        <NotaAvaliacao avaliacao="TF1" nota={ notas.tf1 }/>
                        <NotaAvaliacao avaliacao="AV2" nota={ notas.av2 }/>
                        <NotaAvaliacao avaliacao="TF2" nota={ notas.tf2 }/>
                        <NotaAvaliacao avaliacao="MP" nota={ notas.mp }/>
                        <NotaAvaliacao avaliacao="PF" nota={ notas.pf }/>
                        <NotaAvaliacao avaliacao="TF" nota={ notas.tf }/>
                        <NotaAvaliacao avaliacao="Final" nota={ notas.final }/>
                        <NotaAvaliacao avaliacao="Resultado" nota={ notas.resultado }/>
                    </View>
                }
            </TouchableOpacity>
        );
    }

    useEffect(() => { (async () => {
        setNotas(await extract_boletim(alunoInfo));
    })()
    }, [setNotas]);

    return (
        <View style={[styles.container, { padding: 0 }]}>
        { 
            notas ?
            <FlatList
                data={notas}
                renderItem={(x) => <MateriaBoletim notas={x.item} /> }
            />
            : <Text style={styles.text}>carregando...</Text>
        }
        </View>
    )

}

let Feed = () => {

    const [ loading, isLoading ] = useState(true);
    const [ materias, setMaterias ] = useState(null);
    const [ alunoInfo, setAlunoInfo ] = useState(null);

    useEffect(() => {
        (async () => {
            let [foo, bar] = await extract_materias();

            setMaterias(foo);
            setAlunoInfo(bar);
            isLoading(false);
        })()
    }, [])

    if (loading) {
        return (
            <View style={styles.container}>
                <Text style={styles.text}>carregando...</Text>
            </View>
        )
    }

    return (
        <AlunoContext.Provider value={{materias, alunoInfo}}>
            <Tab.Navigator 
                initialRouteName='Matérias'
                screenOPtions={{ activeTintColor: '#42f44b', }} 
            >
                <Tab.Screen
                    name="Matérias"
                    component={MateriaStack} >
                </Tab.Screen>
                <Tab.Screen
                    name="Boletim"
                    component={Boletim}
                    options={{tabBarLabel: 'Boletim'}} >
                </Tab.Screen>
            </Tab.Navigator>
        </AlunoContext.Provider>
    )
}

export default function App() {
    return (
        <NavigationContainer>
            <Stack.Navigator
                screenOPtions={{ headerShown: false }} 
            >
                <Stack.Screen
                    name="Login"
                    component={Login}
                    options={{title: "Entrar", 
                    /* headerStyle: { backgroundColor: 'black', color: 'white'} */ }}
                />
                <Stack.Screen
                    name="Feed"
                    component={Feed}
                    options={{headerShown: false }}
                />
            </Stack.Navigator>
        </NavigationContainer>
    );
}
