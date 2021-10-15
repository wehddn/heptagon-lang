import * as vscode from 'vscode';

//match comment (not multiline)
const regexComment = new RegExp('\\(\\*.*\\*\\)', 'g'); 
//none empty whitespace
const regexStrictWhiteSpace = new RegExp('^\\s+$', 'g');
//match seperation between variable name
const regexSeperation = new RegExp('[ \t,]', 'g'); 
//match begin function
const regexBeginFunc = new RegExp('(node|fun)', 'g');
//match begin var
const regexBeginVar = new RegExp('(var|const)', 'g');
//match any possible name for variable
const regexName = new RegExp('[a-zA-Z0-9_]+', 'g'); 
//match only possible name
const regexStrictName = new RegExp('^' + regexName.source + '$');
//match any declaration of a variables with their types (in node or behind var)
const regexVarType = new RegExp('(' + regexName.source + '|' + regexSeperation.source + '*)*:[ \t]*' + regexName.source + '(=[a-zA-Z0-9^ \t]*)?;?', 'g');
//match zero or more regexVarType between parantheses
const regexVarTypePar = new RegExp('\\((' + regexVarType.source + ')*\\)', 'g');
//match any node
const regexNode = new RegExp(regexBeginFunc.source + '[ \t]+' + regexName.source + regexVarTypePar.source + '[ \t]*returns[ \t]*' + regexVarTypePar.source, 'g');
//match any declaration of var
const regexVar = new RegExp('var[ \t]*(' + regexVarType.source + ')*', 'g'); 


type Variable = {
    name : string;
    type : string;
};

class VariableDefinition {
    variables : Variable[];
    range : vscode.Range;

    constructor(variables : Variable[], range : vscode.Range){
        this.variables = variables;
        this.range = range;
    }
}

class FunctionDefinition {
    name : string;
    parameters : VariableDefinition;
    outputs : VariableDefinition;
    localVar : VariableDefinition | null;
    range : vscode.Range;
    
    constructor(name : string, parameters: VariableDefinition, outputs : VariableDefinition, localVar : VariableDefinition | null, range : vscode.Range){
        this.name = name;
        this.parameters = parameters;
        this.outputs = outputs;
        this.localVar = localVar;
        this.range = range;
    }
}

export class DocumentDefinition {
    name : string;
    functions : FunctionDefinition[];
    constVar : VariableDefinition[];

    constructor(name : string, functions : FunctionDefinition[], constVar : VariableDefinition[]){
        this.name = name;
        this.functions = functions;
        this.constVar = constVar;
    }
}

function nextWordOfLine(line : string, startCharacter : number) : number {
    let endCharacter = startCharacter+2;
    let word = line.substring(startCharacter, endCharacter);

    while((word.match(regexStrictName) || word.match(regexStrictWhiteSpace))
        && endCharacter < line.length){
        endCharacter++;
        word = line.substring(startCharacter, endCharacter);
    }

    if(endCharacter >= line.length){
        return endCharacter;
    }
    return --endCharacter;
}

function variableDefinitionFactory(document : vscode.TextDocument, range : vscode.Range) : VariableDefinition {
    let variables : Variable[] = [];
    let text = document.getText(range);
    let comments = text.matchAll(regexComment);
    
    for(let comment of comments){
        text.replace(comment[0], "");
    }

    let varBlocks = text.split(";");

    varBlocks.forEach(block => {
        let tmpBlock = block.split(":");

        if(tmpBlock.length === 2){
            let tmpType = tmpBlock[1].match(regexName);

            if(tmpType){
                let type = tmpType[0];

                let varNames = tmpBlock[0].matchAll(regexName);
                
                for(let name of varNames){
                    variables.push({"name" : name[0], "type" : type});
                }
            }
        }
    });

    return new VariableDefinition(variables, range);
}

function functionFactory(document : vscode.TextDocument, startPos : vscode.Position) : FunctionDefinition | null{
    let name : string | null = null;
    let parameters : VariableDefinition | null = null;
    let outputs : VariableDefinition | null = null;
    let localVar : VariableDefinition | null = null;
    let endPos : vscode.Position;

    let line = document.lineAt(startPos.line);
    let endLine = startPos.line;
    let currChar = startPos.character;
    let endChar = 0;
    let word;
    let nbPar = 0;
    let beginPar = new vscode.Position(endLine, 0);
    let beginVar = new vscode.Position(endLine, 0);
    let isEntryHere : boolean = false; //node or fun start the construction
    let isNameHere : boolean = false; //node name (mandatory)
    let isParamHere : boolean = false; //parameters are here (can have none)
    let isOutputHere : boolean = false; //output is here (can have none)
    let isLocalHere : boolean = false; //local var is here (can be false)
    let isBegin : boolean = false; //first let found
    let isEnd : boolean = false; //final tel found

    while(!isEnd){
        while(currChar < line.range.end.character){
            endChar = nextWordOfLine(line.text, currChar);
            word = line.text.substring(currChar, endChar);

            if(!isEntryHere){ //function did not start
                isEntryHere = word.match(regexBeginFunc) !== null;
            }else if(!isNameHere){
                let tmp = word.match(regexName);
                if(tmp){
                    isNameHere = true;
                    name = tmp[0];
                }
            }else if(!isParamHere || !isOutputHere){
                if(word.match('\\(')){
                    if(nbPar === 0){
                        beginPar = new vscode.Position(endLine, currChar);
                    }

                    nbPar++;
                }else if(word.match('\\)')){
                    nbPar--;

                    if(nbPar === 0){
                        let varDef = variableDefinitionFactory(document, new vscode.Range(beginPar, new vscode.Position(endLine, endChar)));

                        if(!isParamHere){
                            isParamHere = true;
                            parameters = varDef;
                        }else{
                            isOutputHere = true;
                            outputs = varDef;
                        }
                    }
                }
            }else if(!isLocalHere){
                if(word.match(regexBeginVar)){
                    beginVar = new vscode.Position(endLine, endChar);
                    isLocalHere = true;
                }
            }

            if(!isBegin && word.match('^let$')){
                isBegin = true;

                if(isLocalHere){
                    let varDef = variableDefinitionFactory(document, new vscode.Range(beginVar, new vscode.Position(endLine, currChar)));
                    localVar = varDef;
                }
            }else if(word.match('^tel$')){
                isEnd = true;
            }

            currChar = endChar;
        }
        endLine++;
        currChar = 0;

        if(endLine >= document.lineCount){
            return null;
        }

        line = document.lineAt(endLine);
    }

    endPos = new vscode.Position(endLine, endChar);

    if(name && parameters && outputs){
        return new FunctionDefinition(name, parameters, outputs, localVar, new vscode.Range(startPos, endPos));
    }
    return null;
}

export function documentFactory(document : vscode.TextDocument) : DocumentDefinition{
    let functions : FunctionDefinition[] = [];
    let constVar : VariableDefinition[] = [];

    let currLine = 0;

    while(currLine < document.lineCount){
        let text = document.lineAt(currLine).text;

        if(text.match(regexBeginFunc)){
            let tmp = functionFactory(document, new vscode.Position(currLine, 0));
            if(tmp){
                functions.push(tmp);

                currLine = tmp.range.end.line;
            }
        }

        currLine++;
    }

    return new DocumentDefinition(document.fileName, functions, constVar);
}


export function parseMultiLine(document : vscode.TextDocument, position1 : vscode.Position, position2 : vscode.Position) : string{
    let text = "";

    if(position1.line === position2.line){
        text = document.lineAt(position1.line).text.substring(position1.character, position2.character);
    }else{
        text = document.lineAt(position1.line).text.substring(position1.character);

        for (let i = position1.line; i < position2.line; i++) {
            text = text + document.lineAt(i).text;      
        }

        text = text + document.lineAt(position2.line).text.substring(0, position2.character);
    }

    return text;
}

function splitVarName(input : string) : Array<string> {
    let regLine = new RegExp('[a-zA-Z0-9_, \t]+:[a-zA-Z0-9_ \t]+;?', 'g');
    let regName = new RegExp('[a-zA-Z0-9_]+', 'g');
    let parseResult = [...input.matchAll(regLine)];
    let result: string[] = [];

    parseResult.forEach(element => {
        let split = element[0].split(":");
        let matchType = split[1].match(regName);
        let type = matchType? matchType[0] : "";

        let parseName = [...split[0].matchAll(regName)];
        parseName.forEach(name => {
            result.push(name[0] + " : " + type);
        });
    });
    return result;
}

function getFuncLine(name: string, document : vscode.TextDocument, position : vscode.Position) : string {
    let regFunc = new RegExp('(node|fun)[ \t]+' + name);
    let regEnd = new RegExp('(var|let)');
    let line = position.line;
    let matchFunc = null;
    let matchEnd = null;

    while(line > -1 && matchFunc === null){
        let text = document.lineAt(line).text;
        matchFunc = text.match(regFunc);
        line--;
    }
    line++;
    let begining = new vscode.Position(line, 0);

    while(line < document.lineCount && matchEnd === null){
        let text = document.lineAt(line).text;
        matchEnd = text.match(regEnd);
        line++;
    }
    let ending = new vscode.Position(line-1, document.lineAt(line-1).range.end.character);

    if(line === document.lineCount){
        //end of the function was never found
        return "";
    }else{
        return parseMultiLine(document, begining, ending);
    }
}

export function parseFunction(document : vscode.TextDocument, position : vscode.Position): Array<string>{
    console.log(getVarRange(document, new vscode.Position(1, 0)));

    let pos2 = new vscode.Position(position.line, position.character - 1);
    let range = document.getWordRangeAtPosition(pos2);
    let funcName: string | null = null;
    if(range){
        funcName = document.lineAt(range.start.line).text.substring(range.start.character, range.end.character);

        if(funcName){
            let input = getFuncLine(funcName, document, pos2);
            
            if(input){
                let regPar = new RegExp('\\([a-zA-Z0-9_,:; \t]*\\)', 'g');
                let result = [...input.matchAll(regPar)];
                let postResult: string[] = [];
                
                funcName += "(";

                let param = splitVarName(result[0][0]);
                

                for (let i = 0; i < param.length; i++) {
                    const element = param[i];
                    postResult.push(element);

                    if(i > 0){
                        funcName += ", " + element;
                    }else{
                        funcName += element;
                    }
                }
                
                funcName += ') -> ' + result[1][0];
                postResult.unshift(funcName);
                
                return postResult;
            }
        }
    }

    return [];
}

function getVarRange(document : vscode.TextDocument, position : vscode.Position) : vscode.Range | null {
    let line = document.lineAt(position.line);
    let endLine = position.line;
    
    
    if(line.text.match(regexBeginVar)){
        endLine++;
        line = document.lineAt(endLine);
        
        //keep matching line until another kind of lines come into play
        while(!(line.isEmptyOrWhitespace || line.text.match(regexBeginVar) || line.text.match(regexBeginFunc) || line.text.match('/let/g'))
            && endLine < document.lineCount){
            endLine++;
            line = document.lineAt(position.line);
        }

        endLine--;
        let endCharacter = document.lineAt(endLine).range.end.character;
        let pos2 = new vscode.Position(endLine, endCharacter);
        let text = parseMultiLine(document, position, pos2);
        let comments = text.matchAll(regexComment);

        for(let comment in comments){
            text.replace(comment, "");
        }

        //check if the final result is indeed a var declaration
        if(text.match(regexVar)){
            return new vscode.Range(position, pos2);
        }
    }
    return null;
}

//get node range starting from the given position, if it exist (start at this position)
function getNodeRange(document : vscode.TextDocument, position : vscode.Position) : vscode.Range | null {
    let line = document.lineAt(position.line).text;
    let endLine = position.line;
    let endCharacter = document.lineAt(endLine).range.end.character;

    if(line.match(regexBeginFunc)){ // begin like a function but it could be multiline
        let comments;

        while(line.match(regexNode) === null && endLine < document.lineCount){
            endLine++;
            endCharacter = document.lineAt(endLine).range.end.character;
            line = parseMultiLine(document, position, new vscode.Position(endLine, endCharacter));

            comments = line.matchAll(regexComment);
            
            for(let comment of comments){
                console.log(comment);
                line.replace(comment[0], "");
            }
        }

        if(endLine < document.lineCount){
            return new vscode.Range(position, new vscode.Position(endLine, endCharacter));
        }
    }
    return null;
}

/*
export function findDefPos(name : string, document : vscode.TextDocument, position : vscode.Position) : vscode.Range {


    return new vscode.Range();
}
*/