import { useRef, useState, useEffect, ChangeEvent } from "react";
import {
  Stack,
  Panel,
  Layer,
  Popup,
  FocusTrapZone,
  DefaultButton,
  Overlay,
} from "@fluentui/react";
import {
  BroomRegular,
  DismissRegular,
  SquareRegular,
  ShieldLockRegular,
} from "@fluentui/react-icons";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

import styles from "./Chat4.module.css";
import Azure from "../../assets/Shadow Seller 23 06 20 v2-3.png";

import {
  ChatMessage,
  ConversationRequest,
  conversationApi,
  Citation,
  ToolMessageContent,
  ChatResponse,
  getUserInfo,
  selectConversationHistory,
  Conversation,
  saveConversation,
} from "../../api";
import { Answer } from "../../components/Answer";
import { QuestionInput } from "../../components/QuestionInput";
import { SaveButton } from "../../components/SaveButton";
import { ChatHistory } from "../../components/ChatHistory";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { loginRequest } from "../../authConfig";
import { Dropdown } from "react-bootstrap";


const Chat4 = () => {
  const lastQuestionRef = useRef<string>("");
  const chatMessageStreamEnd = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showLoadingMessage, setShowLoadingMessage] = useState<boolean>(false);
  const [activeCitation, setActiveCitation] =
    useState<
      [
        content: string,
        id: string,
        title: string,
        filepath: string,
        url: string,
        metadata: string
      ]
    >();
  const [isCitationPanelOpen, setIsCitationPanelOpen] = useState<boolean>(false);
  const [answers, setAnswers] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const abortFuncs = useRef([] as AbortController[]);
  const [showAuthMessage, setShowAuthMessage] = useState<boolean>(true);
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isPopupVisible, setPopupVisible] = useState<boolean>(false);
  const [chatTitleText, setChatTitleText] = useState("");

  const getUserInfoList = async () => {
    const userInfoList = await getUserInfo();
    if (userInfoList.length === 0 && window.location.hostname !== "localhost") {
      setShowAuthMessage(true);
    } else {
      setShowAuthMessage(false);
    }
  };

  const makeApiRequest = async (question: string) => {
    lastQuestionRef.current = question;

    setIsLoading(true);
    setShowLoadingMessage(true);
    const abortController = new AbortController();
    abortFuncs.current.unshift(abortController);

    const userMessage: ChatMessage = {
      role: "user",
      content: question,
    };

    const request: ConversationRequest = {
      messages: [...answers, userMessage],
    };

    let result = {} as ChatResponse;
    try {
      const response = await conversationApi(request, abortController.signal);
     
      if (response?.body) {
        const reader = response.body.getReader();
        let runningText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          var text = new TextDecoder("utf-8").decode(value);
          const objects = text.split("\n");
          //alert(objects);
          objects.forEach((obj) => {
            try {
              runningText += obj;
              result = JSON.parse(runningText);
              setShowLoadingMessage(false);
              setAnswers([
                ...answers,
                userMessage,
                ...result.choices[0].messages,
              ]);
              runningText = "";
            } catch {}
          });
        }
        setAnswers([...answers, userMessage, ...result.choices[0].messages]);
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        console.error(e);
        console.error(result);
        alert(
          "An error occurred. Please try again. If the problem persists, please contact your site administrator."
        );
      }
      setAnswers([...answers, userMessage]);
    } finally {
      setIsLoading(false);
      setShowLoadingMessage(false);
      abortFuncs.current = abortFuncs.current.filter(
        (a) => a !== abortController
      );
    }

    return abortController.abort();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setChatTitleText(event.target.value);
  };

  const cancelConversation = () => {
    setChatTitleText("");
    setPopupVisible(false);
  };


  const saveChat = async () => {
    setPopupVisible(false);
    //setChatTitleText(chatTitleText);
    let conversationText = "";
    const arrayFromMapValues = Array.from(answers.values());
    let result = [] as ChatMessage[];
    // Loop over the array
    arrayFromMapValues.forEach((val) => {
      try {
        if (val.role != "tool") {
        conversationText += JSON.stringify(val);
        let chatMessage = {} as ChatMessage;
        chatMessage = JSON.parse(conversationText);
        result.push(chatMessage);
        conversationText = "";
        }
      } catch {}
    });
    //alert(JSON.stringify(result));
    //alert(chatTitleText);
    const r = await saveConversation("joelborellis@outlook.com", chatTitleText, result);
    const rJson = await r.json();
  };

  const openSaveConvo = async () => {
    setChatTitleText("");
    setPopupVisible(true);
  }

  const dismissPanel = async () => {
    setConversations([]);
    setIsOpen(false);
  };

  const hidePopup = async () => {
    setPopupVisible(false);
  };

  const populateConversation = async (conversation: Conversation)=> {
    //alert(selected);
    const sJson = JSON.stringify(conversation);
    const pJson = JSON.parse(sJson) as Conversation;

    //document.write(JSON.stringify(pJson.messages));

    setAnswers(pJson.messages);

    setConversations([]);
    setIsOpen(false);
  }

  const parseConversationTitle = (conversation: Conversation) => {
    try {
      const sJson = JSON.stringify(conversation);
      const pJson = JSON.parse(sJson) as Conversation;
      return pJson.title;
    } catch {
      return "";
    }
};

  const selectHistory = async (user: string) => {
    // Silently acquires an access token which is then attached to a request for MS Graph data
    //instance.acquireTokenSilent({
    //...loginRequest,
    //account: accounts[0],
    //});

    //let user = accounts[0].username;
    setAnswers([]);
    setIsOpen(true);

    const r = await selectConversationHistory(user);
    const rJson = await r.json();

    const conversations = [] as Conversation[];

    const arrayFromMapValues = Array.from(rJson.values());
    let convoText = "";
    arrayFromMapValues.forEach((val) => {
      convoText += JSON.stringify(val)
      let conversation = {} as Conversation;
      conversation = JSON.parse(convoText);
      //alert(JSON.stringify(conversation));
      conversations.push(conversation);
      setConversations(conversations);
      convoText = "";
    })
  };

  const clearChat = async () => {
    lastQuestionRef.current = "";
    setActiveCitation(undefined);
    setAnswers([]);
  };

  const stopGenerating = () => {
    abortFuncs.current.forEach((a) => a.abort());
    setShowLoadingMessage(false);
    setIsLoading(false);
  };

  useEffect(() => {
    getUserInfoList();
  }, []);

  useEffect(
    () => chatMessageStreamEnd.current?.scrollIntoView({ behavior: "smooth" }),
    [showLoadingMessage]
  );

  const onShowCitation = (citation: Citation) => {
    setActiveCitation([
      citation.content,
      citation.id,
      citation.title ?? "",
      citation.filepath ?? "",
      "",
      "",
    ]);
    setIsCitationPanelOpen(true);
  };

  const parseCitationFromMessage = (message: ChatMessage) => {
    if (message.role === "tool") {
      try {
        const toolMessage = JSON.parse(message.content) as ToolMessageContent;
        return toolMessage.citations;
      } catch {
        return [];
      }
    }
    return [];
  };

  return (
    <div className={styles.container}>
      {showAuthMessage ? (
        <Stack className={styles.chatEmptyState}>
          <ShieldLockRegular
            className={styles.chatIcon}
            style={{ color: "darkorange", height: "200px", width: "200px" }}
          />
          <h1 className={styles.chatEmptyStateTitle}>
            Authentication Not Configured
          </h1>
          <h2 className={styles.chatEmptyStateSubtitle}>
            This app does not have authentication configured. Please add an
            identity provider by finding your app in the
            <a href="https://portal.azure.com/" target="_blank">
              {" "}
              Azure Portal{" "}
            </a>
            and following
            <a
              href="https://learn.microsoft.com/en-us/azure/app-service/scenario-secure-app-authentication-app-service#3-configure-authentication-and-authorization"
              target="_blank"
            >
              {" "}
              these instructions
            </a>
            .
          </h2>
          <h2
            className={styles.chatEmptyStateSubtitle}
            style={{ fontSize: "20px" }}
          >
            <strong>
              Authentication configuration takes a few minutes to apply.{" "}
            </strong>
          </h2>
          <h2
            className={styles.chatEmptyStateSubtitle}
            style={{ fontSize: "20px" }}
          >
            <strong>
              If you deployed in the last 10 minutes, please wait and reload the
              page after 10 minutes.
            </strong>
          </h2>
        </Stack>
      ) : (
        <Stack horizontal className={styles.chatRoot}>
          <div className={styles.chatContainer}>
            {!lastQuestionRef.current ? (
              <Stack className={styles.chatEmptyState}>
                <img
                  src={Azure}
                  className={styles.chatIcon}
                  aria-hidden="true"
                />
                <h1 className={styles.chatEmptyStateTitle}>Shadow Suggestion Module ...</h1>
                <h2 className={styles.chatEmptyStateSubtitle}>
                We’ve got less time and more to do.  I’ll help you get better prepared, faster. Feel free to ask follow up questions for more details and context.
                </h2>
              </Stack>
            ) : (
              <div
                className={styles.chatMessageStream}
                style={{ marginBottom: isLoading ? "40px" : "0px" }}
              >
                {answers.map((answer, index) => ( 
                  <>
                    {answer.role === "user" ? (
                      <div className={styles.chatMessageUser}>
                        <div className={styles.chatMessageUserMessage}>
                          {answer.content}
                        </div>
                      </div>
                    ) : answer.role === "assistant" ? (
                      <div className={styles.chatMessageGpt}>
                        <Answer
                          answer={{
                            answer: answer.content,
                            citations: parseCitationFromMessage(
                              answers[index - 1]
                            ),
                          }}
                          onCitationClicked={(c) => onShowCitation(c)}
                        />
                      </div>
                    ) : null}
                  </>
                ))}
                {showLoadingMessage && (
                  <>
                    <div className={styles.chatMessageUser}>
                      <div className={styles.chatMessageUserMessage}>
                        {lastQuestionRef.current}
                      </div>
                    </div>
                    <div className={styles.chatMessageGpt}>
                      <Answer
                        answer={{
                          answer: "Generating answer...",
                          citations: [],
                        }}
                        onCitationClicked={() => null}
                      />
                    </div>
                  </>
                )}
                <div ref={chatMessageStreamEnd} />
              </div>
            )}
            
            <Stack horizontal className={styles.chatInput}>
            
              {isLoading && (
                <Stack
                  horizontal
                  className={styles.stopGeneratingContainer}
                  role="button"
                  aria-label="Stop generating"
                  tabIndex={0}
                  onClick={stopGenerating}
                  onKeyDown={(e: { key: string }) =>
                    e.key === "Enter" || e.key === " " ? stopGenerating() : null
                  }
                >
                  <SquareRegular
                    className={styles.stopGeneratingIcon}
                    aria-hidden="true"
                  />
                  <span
                    className={styles.stopGeneratingText}
                    aria-hidden="true"
                  >
                    Stop generating
                  </span>
                </Stack>
              )}
              <BroomRegular
                className={styles.clearChatBroom}
                style={{
                  background:
                    isLoading || answers.length === 0
                      ? "#BDBDBD"
                      : "radial-gradient(109.81% 107.82% at 100.1% 90.19%, #0F6CBD 33.63%, #2D87C3 70.31%, #8DDDD8 100%)",
                  cursor: isLoading || answers.length === 0 ? "" : "pointer",
                }}
                onClick={clearChat}
                onKeyDown={(e) =>
                  e.key === "Enter" || e.key === " " ? clearChat() : null
                }
                aria-label="Clear session"
                role="button"
                tabIndex={0}
              />

              <SaveButton
                disabled={isLoading || answers.length === 0}
                onSave={() => openSaveConvo()}
              />

              {isPopupVisible && (
                    <Layer>
                      <Popup
                        className={styles.popupRoot}
                        role="dialog"
                        aria-modal="true"
                        onDismiss={hidePopup}
                      >
                        <Overlay onChange={handleChange} />
                        <FocusTrapZone>
                          <div role="document" className={styles.popupContent}>
                            <h5>Title of Conversation</h5>
                            <p>
                              <input
                                type="text"
                                id="chatTitleText"
                                name="chatTitleText"
                                onChange={handleChange}
                                value={chatTitleText}
                              />
                            </p>
                            <DefaultButton onClick={saveChat}>Save</DefaultButton>
                            <DefaultButton onClick={cancelConversation}>Cancel</DefaultButton>
                          </div>
                        </FocusTrapZone>
                      </Popup>
                    </Layer>
                  )}


              <ChatHistory
                disabled={isLoading || answers.length === 0}
                onLoad={() => selectHistory("joelborellis@outlook.com")}
              />

              {isOpen && (
                <Panel
                  headerText="Conversation History"
                  // this prop makes the panel non-modal
                  isBlocking={false}
                  isOpen={isOpen}
                  onDismiss={dismissPanel}
                  closeButtonAriaLabel="Close"
                >
                  <Dropdown
                    className="d-inline mx-2"
                    drop="start"
                    title="Choose a chat to load"
                  >
                  {conversations.map((conversation: Conversation) => (         
                    <div>
                    {/* mapping over the conversations array and displaying each item */}                                      
                    <Dropdown.Item
                        as="button"
                        onClick={() => populateConversation(conversation)}              
                      >
                      {parseConversationTitle(conversation)}         
                    </Dropdown.Item>                                    
                    </div>    
                  ))}                        
                    
                  </Dropdown>
                </Panel>
              )}

              <QuestionInput
                clearOnSend
                placeholder="Let’s chat...talk to me about the situation. Tell me what you need and where we’re at?"
                disabled={isLoading}
                onSend={(question) => makeApiRequest(question)}
              />
              
            </Stack>
          </div>
          {answers.length > 0 && isCitationPanelOpen && activeCitation && (
            <Stack.Item className={styles.citationPanel}>
              <Stack
                horizontal
                className={styles.citationPanelHeaderContainer}
                horizontalAlign="space-between"
                verticalAlign="center"
              >
                <span className={styles.citationPanelHeader}>Citations</span>
                <DismissRegular
                  className={styles.citationPanelDismiss}
                  onClick={() => setIsCitationPanelOpen(false)}
                />
              </Stack>
              <h5 className={styles.citationPanelTitle}>{activeCitation[2]}</h5>
              <ReactMarkdown
                linkTarget="_blank"
                className={styles.citationPanelContent}
                children={activeCitation[0]}
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
              />
            </Stack.Item>
          )}
        </Stack>
      )}
    </div>
  );
};

export default Chat4;
