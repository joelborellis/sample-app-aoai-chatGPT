import json
import os
import logging
import requests
import openai
from flask import Flask, Response, request, jsonify
from dotenv import load_dotenv
import azure.cosmos.documents as documents
import azure.cosmos.cosmos_client as cosmos_client
import re
import uuid
from langchain.embeddings.openai import OpenAIEmbeddings
from langchain.vectorstores.azuresearch import AzureSearch
from azure.search.documents.indexes.models import (
    SearchableField,
    SearchField,
    SearchFieldDataType,
    SimpleField,
    ScoringProfile,
    TextWeights,
)

load_dotenv()

app = Flask(__name__)

@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def static_file(path):
    return app.send_static_file(path)

# ACS Integration Settings
AZURE_SEARCH_SERVICE = os.environ.get("AZURE_SEARCH_SERVICE")
AZURE_SEARCH_INDEX = os.environ.get("AZURE_SEARCH_INDEX")
AZURE_SEARCH_KEY = os.environ.get("AZURE_SEARCH_KEY")
AZURE_SEARCH_USE_SEMANTIC_SEARCH = os.environ.get("AZURE_SEARCH_USE_SEMANTIC_SEARCH", False)
AZURE_SEARCH_SEMANTIC_SEARCH_CONFIG = os.environ.get("AZURE_SEARCH_SEMANTIC_SEARCH_CONFIG", "default")
AZURE_SEARCH_TOP_K = os.environ.get("AZURE_SEARCH_TOP_K", 5)
AZURE_SEARCH_ENABLE_IN_DOMAIN = os.environ.get("AZURE_SEARCH_ENABLE_IN_DOMAIN", "true")
AZURE_SEARCH_CONTENT_COLUMNS = os.environ.get("AZURE_SEARCH_CONTENT_COLUMNS")
AZURE_SEARCH_FILENAME_COLUMN = os.environ.get("AZURE_SEARCH_FILENAME_COLUMN")
AZURE_SEARCH_TITLE_COLUMN = os.environ.get("AZURE_SEARCH_TITLE_COLUMN")
AZURE_SEARCH_URL_COLUMN = os.environ.get("AZURE_SEARCH_URL_COLUMN")

# AOAI Integration Settings these are in the app service Configuration setting in Azure
AZURE_OPENAI_RESOURCE = os.environ.get("AZURE_OPENAI_RESOURCE")
AZURE_OPENAI_MODEL = os.environ.get("AZURE_OPENAI_MODEL")
AZURE_OPENAI_KEY = os.environ.get("AZURE_OPENAI_KEY")
AZURE_OPENAI_TEMPERATURE = os.environ.get("AZURE_OPENAI_TEMPERATURE")
AZURE_OPENAI_TOP_P = os.environ.get("AZURE_OPENAI_TOP_P")
AZURE_OPENAI_MAX_TOKENS = os.environ.get("AZURE_OPENAI_MAX_TOKENS")
AZURE_OPENAI_STOP_SEQUENCE = os.environ.get("AZURE_OPENAI_STOP_SEQUENCE")
AZURE_OPENAI_SYSTEM_MESSAGE = os.environ.get("AZURE_OPENAI_SYSTEM_MESSAGE")
AZURE_OPENAI_PREVIEW_API_VERSION = os.environ.get("AZURE_OPENAI_PREVIEW_API_VERSION")
AZURE_OPENAI_STREAM = os.environ.get("AZURE_OPENAI_STREAM", "true")
AZURE_OPENAI_MODEL_NAME = os.environ.get("AZURE_OPENAI_MODEL_NAME") # Name of the model, e.g. 'gpt-35-turbo' or 'gpt-4'

SHOULD_STREAM = True if AZURE_OPENAI_STREAM.lower() == "true" else False

HOST = os.environ.get("HOST")
MASTER_KEY = os.environ.get("MASTER_KEY")
DATABASE_ID = os.environ.get("DATABASE_ID")
CONTAINER_ID = os.environ.get("CONTAINER_ID")

model: str = "text-embedding-ada-002"

vector_store_address: str = os.getenv("AZURE_SEARCH_SERVICE_ENDPOINT")
vector_store_password: str = os.getenv("AZURE_SEARCH_KEY")
embeddings: OpenAIEmbeddings = OpenAIEmbeddings(openai_api_key=AZURE_OPENAI_KEY,deployment=model, chunk_size=1)
embedding_function = embeddings.embed_query

def is_chat_model():
    if 'gpt-35' in AZURE_OPENAI_MODEL_NAME.lower():
        return True
    return False

def should_use_data():
    if AZURE_SEARCH_SERVICE and AZURE_SEARCH_INDEX and AZURE_SEARCH_KEY:
        return True
    return False

def prepare_body_headers_with_data(request):
    request_messages = request.json["messages"]

    #with open('promp.json', 'w') as fp:
                #fp.write(json.dumps(request_messages))
                
    body = {
        "messages": request_messages,
        "temperature": float(AZURE_OPENAI_TEMPERATURE),
        "max_tokens": int(AZURE_OPENAI_MAX_TOKENS),
        "top_p": float(AZURE_OPENAI_TOP_P),
        "stop": AZURE_OPENAI_STOP_SEQUENCE.split("|") if AZURE_OPENAI_STOP_SEQUENCE else None,
        "stream": SHOULD_STREAM,
        "dataSources": [
            {
                "type": "AzureCognitiveSearch",
                "parameters": {
                    "endpoint": f'https://{AZURE_SEARCH_SERVICE}.search.windows.net',
                    "key": AZURE_SEARCH_KEY,
                    "indexName": AZURE_SEARCH_INDEX,
                    "fieldsMapping": {
                        "contentField": AZURE_SEARCH_CONTENT_COLUMNS.split("|") if AZURE_SEARCH_CONTENT_COLUMNS else [],
                        "titleField": AZURE_SEARCH_TITLE_COLUMN if AZURE_SEARCH_TITLE_COLUMN else None,
                        "urlField": AZURE_SEARCH_URL_COLUMN if AZURE_SEARCH_URL_COLUMN else None,
                        "filepathField": AZURE_SEARCH_FILENAME_COLUMN if AZURE_SEARCH_FILENAME_COLUMN else None
                    },
                    "inScope": True if AZURE_SEARCH_ENABLE_IN_DOMAIN.lower() == "true" else False,
                    "topNDocuments": AZURE_SEARCH_TOP_K,
                    "queryType": "semantic" if AZURE_SEARCH_USE_SEMANTIC_SEARCH.lower() == "true" else "simple",
                    "semanticConfiguration": AZURE_SEARCH_SEMANTIC_SEARCH_CONFIG if AZURE_SEARCH_USE_SEMANTIC_SEARCH.lower() == "true" and AZURE_SEARCH_SEMANTIC_SEARCH_CONFIG else "",
                    "roleInformation": AZURE_OPENAI_SYSTEM_MESSAGE
                }
            }
        ]
    }

    chatgpt_url = f'https://{AZURE_OPENAI_RESOURCE}.openai.azure.com/openai/deployments/{AZURE_OPENAI_MODEL}'
    if is_chat_model():
        chatgpt_url += f'/chat/completions?api-version=2023-03-15-preview'
    else:
        chatgpt_url += f'/completions?api-version=2023-03-15-preview'

    headers = {
        "Content-Type": "application/json",
        "api-key": AZURE_OPENAI_KEY,
        "chatgpt_url": chatgpt_url,
        "chatgpt_key": AZURE_OPENAI_KEY,
        "x-ms-useragent": "ShadowSeller/1.0.0"
    }
    return body, headers

def stream_with_data(body, headers, endpoint):    
    s = requests.Session()
    response = {
        "id": "",
        "model": "",
        "created": 0,
        "object": "",
        "choices": [{
            "messages": []
        }]
    }
    try:
        #print(endpoint)
        #print(headers)
        with s.post(endpoint, json=body, headers=headers, stream=True) as r:

            for line in r.iter_lines(chunk_size=10):
                if line:
                    lineJson = json.loads(line.lstrip(b"data:").decode("utf-8"))                    
                    if "error" in lineJson:
                        yield json.dumps(lineJson).replace("\n", "\\n") + "\n"
                    response["id"] = lineJson["id"]
                    response["model"] = lineJson["model"]
                    response["created"] = lineJson["created"]
                    response["object"] = lineJson["object"]
                    
                    role = lineJson["choices"][0]["messages"][0]["delta"].get("role")    
                    if role == "tool":
                        response["choices"][0]["messages"].append(lineJson["choices"][0]["messages"][0]["delta"])
                    elif role == "assistant": 
                        response["choices"][0]["messages"].append({
                            "role": "assistant",
                            "content": ""
                        })
                    else:
                        deltaText = lineJson["choices"][0]["messages"][0]["delta"]["content"]
                        if deltaText != "[DONE]":
                            response["choices"][0]["messages"][1]["content"] += deltaText              
                    with open('response.json', 'w') as fp:
                        fp.write(json.dumps(json.dumps(response)))
                    yield json.dumps(response).replace("\n", "\\n") + "\n"
                                    
                            
    except Exception as e:
        print(json.dumps(str(e)))
        yield json.dumps({"error": str(e)}).replace("\n", "\\n") + "\n"

def conversation_with_data(request):
    body, headers = prepare_body_headers_with_data(request)
    endpoint = f"https://{AZURE_OPENAI_RESOURCE}.openai.azure.com/openai/deployments/{AZURE_OPENAI_MODEL}/extensions/chat/completions?api-version={AZURE_OPENAI_PREVIEW_API_VERSION}"

    if not SHOULD_STREAM:
        r = requests.post(endpoint, headers=headers, json=body)
        status_code = r.status_code
        r = r.json()

        return Response(json.dumps(r).replace("\n", "\\n"), status=status_code)
    else:
        if request.method == "POST":
            return Response(stream_with_data(body, headers, endpoint), mimetype="text/event-stream")
        else:
            return Response(None, mimetype='text/event-stream')

def stream_without_data(response):
    responseText = ""
    for line in response:
        print(json.dumps(line))
        deltaText = line["choices"][0]["delta"].get('content')
        if deltaText and deltaText != "[DONE]":
            responseText += deltaText

        response_obj = {
            "id": line["id"],
            "model": line["model"],
            "created": line["created"],
            "object": line["object"],
            "choices": [{
                "messages": [{
                    "role": "assistant",
                    "content": responseText
                }]
            }]
        }
        yield json.dumps(response_obj).replace("\n", "\\n") + "\n"

def conversation_without_data(request):
    openai.api_type = "azure"
    openai.api_base = f"https://{AZURE_OPENAI_RESOURCE}.openai.azure.com/"
    openai.api_version = AZURE_OPENAI_PREVIEW_API_VERSION
    openai.api_key = AZURE_OPENAI_KEY

    request_messages = request.json["messages"]
    messages = [
        {
            "role": "system",
            "content": AZURE_OPENAI_SYSTEM_MESSAGE
        }
    ]

    for message in request_messages:
        messages.append({
            "role": message["role"] ,
            "content": message["content"]
        })
    print(json.dumps(messages))
    response = openai.ChatCompletion.create(
        engine=AZURE_OPENAI_MODEL,
        messages = messages,
        temperature=float(AZURE_OPENAI_TEMPERATURE),
        max_tokens=int(AZURE_OPENAI_MAX_TOKENS),
        top_p=float(AZURE_OPENAI_TOP_P),
        stop=AZURE_OPENAI_STOP_SEQUENCE.split("|") if AZURE_OPENAI_STOP_SEQUENCE else None,
        stream=SHOULD_STREAM
    )

    if not SHOULD_STREAM:
        response_obj = {
            "id": response,
            "model": response.model,
            "created": response.created,
            "object": response.object,
            "choices": [{
                "messages": [{
                    "role": "assistant",
                    "content": response.choices[0].message.content
                }]
            }]
        }
        print(json.dumps(response_obj))

        return jsonify(response_obj), 200
    else:
        if request.method == "POST":
            return Response(stream_without_data(response), mimetype='text/event-stream')
        else:
            return Response(None, mimetype='text/event-stream')
        
def search(query: str):
    fields = [
    SimpleField(
        name="id",
        type=SearchFieldDataType.String,
        key=True,
        filterable=True,
    ),
    SearchableField(
        name="content",
        type=SearchFieldDataType.String,
        searchable=True,
    ),
    SearchField(
        name="content_vector",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        searchable=True,
        vector_search_dimensions=len(embedding_function("Text")),
        vector_search_configuration="default",
    ),
    SearchableField(
        name="metadata",
        type=SearchFieldDataType.String,
        searchable=True,
    ),
    # Additional field to store the title
    SearchableField(
        name="title",
        type=SearchFieldDataType.String,
        searchable=True,
    ),
    # Additional field for filtering on document source
    SimpleField(
        name="source",
        type=SearchFieldDataType.String,
        filterable=True,
    ),
]
    
    vector_store: AzureSearch = AzureSearch(
        azure_search_endpoint=vector_store_address,
        azure_search_key=vector_store_password,
        index_name="langchain-demo-vector-index",
        embedding_function=embedding_function,
        fields=fields,
    )
    
    # Generate the query vector testing the function
    #query_vector = embeddings.embed_query("describe the challenger sales model")
    #print(query_vector)
    
    # Perform a similarity search
    docs = vector_store.similarity_search(
        query=query,
        k=3,
        search_type="similarity",
    )
    print(docs[0].page_content)
        

def get_conversation_history(request):
    
    user = request.json["user"]
    
    client = cosmos_client.CosmosClient(HOST, {'masterKey': MASTER_KEY}, user_agent="ShadowSellerAgent", user_agent_overwrite=True)
      
    db = client.get_database_client(DATABASE_ID)
    #print('Database with id \'{0}\' was found'.format(DATABASE_ID))
    container = db.get_container_client(CONTAINER_ID)
    #print('Container with id \'{0}\' was found'.format(CONTAINER_ID))
    
    items = list(container.query_items(
        query="SELECT * FROM r WHERE r.user=@user",
        parameters=[
            { "name":"@user", "value": user }
        ],
        enable_cross_partition_query=True,
    ))

    return Response(json.dumps(items), mimetype="application/json", status=200)

# get a UUID - URL safe, Base64
def get_a_uuid():
    return str(uuid.uuid4())

def save_conversation(request):

    client = cosmos_client.CosmosClient(HOST, {'masterKey': MASTER_KEY}, user_agent="ShadowSellerAgent", user_agent_overwrite=True)
      
    db = client.get_database_client(DATABASE_ID)
    #print('Database with id \'{0}\' was found'.format(DATABASE_ID))
    container = db.get_container_client(CONTAINER_ID)
    #print('Container with id \'{0}\' was found'.format(CONTAINER_ID))
    
    messages = request.json["messages"]
    
    #replace the [doc] placeholders for the citations
    for item in messages:
        item["content"] = re.sub(r'\[.*?\]', '', item["content"])
        #print(item["content"])

    #print(json.dumps(messages, indent=2))
      
    conversation = {
    "id": get_a_uuid(),
    "title": request.json["title"],
    "user": request.json["user"],
    "messages": messages,
}
    
    container.create_item(body=conversation)
    
    return Response(mimetype="application/json", status=200)


@app.route("/conversation", methods=["GET", "POST"])
def conversation():
    try:
        use_data = should_use_data()
        if use_data:
            return conversation_with_data(request)
        else:
            return conversation_without_data(request)
    except Exception as e:
        logging.exception("Exception in /conversation")
        return jsonify({"error": str(e)}), 500
    
@app.route("/selectconversationhistory", methods=["GET", "POST"])
def getchathistory():
    try:
        #res = get_user_history(request)
        #print("response:  ", res.get_data().decode("utf-8"))
        return get_conversation_history(request)
    except Exception as e:
        logging.exception("Exception in /selectconversationhistory")
        return jsonify({"error": str(e)}), 500
    
@app.route("/saveconversation", methods=["GET", "POST"])
def saveconversation():
    try:
        return save_conversation(request)
    except Exception as e:
        logging.exception("Exception in /saveconversation")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)