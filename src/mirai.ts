/**
 * 导出一个 Mirai 类，具体见类的各个属性和方法。
 * @packageDocumentation
 */

import * as axios from "./axios";
import { AxiosStatic } from "axios";
import MiraiApiHttp from "./mirai-api-http";
import { MessageType, EventType, MiraiApiHttpConfig } from ".";
import Logger from "./utils/logger";

import { getPlain, splitText } from "./utils";
import { isAt, isChatMessage } from "./utils/check";
import {
  NewFriendRequestOperationType,
  MemberJoinRequestOperationType,
  BotInvitedJoinGroupRequestOperationType,
} from "./mirai-api-http/resp";

import events from "events";

/**
 * 所有消息
 */
export type MessageAndEvent = MessageType.ChatMessage | EventType.Event;

/**
 * 所有消息类型
 */
export type MessageAndEventType =
  | MessageType.ChatMessageType
  | EventType.EventType;

/**
 * 数据类型
 */
type Data<
  T extends "message" | EventType.EventType | MessageType.ChatMessageType
> = T extends EventType.EventType
  ? EventType.EventMap[T]
  : T extends MessageType.ChatMessageType
  ? MessageType.ChatMessageMap[T]
  : MessageType.ChatMessage;

type SendMessageType = "friend" | "group";

/**
 * Mirai SDK 初始化类
 */
export default class Mirai {
  /**
   * 封装 mirai-api-http 的固有方法
   */
  api: MiraiApiHttp;
  /**
   * 日志模块
   */
  logger = new Logger();
  /**
   * 请求工具
   */
  axios: AxiosStatic;
  qq: number;
  /**
   * 是否验证成功
   */
  verified: boolean;
  /**
   * 监听器状态（false 则不执行监听器回调函数）
   */
  active: boolean;
  /**
   * 监听者之前执行的函数
   */
  beforeListener: Function[];
  /**
   * 监听者之后执行的函数
   */
  afterListener: Function[];
  /**
   * 轮询获取消息的时间间隔，默认 200 ms，仅在未开启 Websocket 时有效
   */
  interval: number;
  /**
   * fetchMessage 重试次数
   */
  retries: number;
  /**
   * 当前处理的消息
   */
  curMsg?: MessageType.ChatMessage | EventType.Event;
  /**
   * 事件触发器
   */
  eventEmitter = new events.EventEmitter();
  constructor(
    public mahConfig: MiraiApiHttpConfig = {
      host: "0.0.0.0",
      port: 8080,
      authKey: "el-psy-congroo",
      cacheSize: 4096,
      enableWebsocket: false,
      cors: ["*"],
    }
  ) {
    this.axios = axios.init(
      `http://${this.mahConfig.host}:${this.mahConfig.port}`
    );
    this.api = new MiraiApiHttp(this.mahConfig, this.axios);

    // default
    this.qq = 0;
    this.verified = false;

    this.active = true;
    this.beforeListener = [];
    this.afterListener = [];
    this.interval = 200;
    this.retries = 10;
  }

  async about() {
    const pkg = require("../package.json");
    this.logger.info(`Version ${pkg.version}`);
    this.logger.info(`Docs: ${pkg.homepage}`);
    this.logger.info(`GitHub: ${pkg.repository.url}`);
  }

  /**
   * link 链接 mirai 已经登录的 QQ 号
   */
  async link(qq: number) {
    this.qq = qq;
    this.api.handleStatusCode();
    await this.auth();
    const data = await this.verify();
    return data;
  }

  /**
   * 获取 Session
   * data.code === 0 成功
   */
  async auth() {
    const data = await this.api.auth();
    if (data.code === 0) {
      this.logger.info(`获取 Session: ${data.session}`);
    }
    return data;
  }

  /**
   * 激活 Session，绑定 QQ
   * data.code === 0 成功
   */
  async verify() {
    const data = await this.api.verify(this.qq);
    if (data.code === 0) {
      this.logger.success("验证成功");
      this.verified = true;
    } else {
      this.logger.error("验证失败");
    }
    return data;
  }

  /**
   * 释放 Session
   */
  async release() {
    const data = await this.api.release();
    if (data.code === 0) {
      this.logger.success(`释放 ${this.qq} Session: ${this.api.sessionKey}`);
    }
    return data;
  }

  /**
   * message 展开为 FriendMessage | GroupMessage | TempMessage
   * @param method
   * @param callback
   */
  _adaptMessageForAll<
    T extends "message" | EventType.EventType | MessageType.ChatMessageType
  >(method: "on" | "off" | "once", callback: (data: Data<T>) => any) {
    const emitter = this.eventEmitter;
    const messageType = ["FriendMessage", "GroupMessage", "TempMessage"];
    messageType.forEach((message) => {
      emitter[method](message, callback);
    });
  }

  /**
   * 绑定事件列表
   * message: FriendMessage | GroupMessage | TempMessage
   * [mirai-api-http事件类型一览](https://github.com/project-mirai/mirai-api-http/blob/master/EventType.md)
   * mirai.on('MemberMuteEvent', ()=>{})
   * @param type
   * @param callback
   */
  on<T extends "message" | EventType.EventType | MessageType.ChatMessageType>(
    type: T,
    callback: (data: Data<T>) => any
  ) {
    const emitter = this.eventEmitter;
    // 监听所有消息类型
    if (type === "message") {
      this._adaptMessageForAll("on", callback);
    } else {
      emitter.on(type, callback);
    }
  }

  /**
   * 仅处理事件一次
   * @param type
   * @param callback
   */
  once<T extends "message" | EventType.EventType | MessageType.ChatMessageType>(
    type: T,
    callback: (data: Data<T>) => any
  ) {
    const emitter = this.eventEmitter;
    if (type === "message") {
      this._adaptMessageForAll("once", callback);
    } else {
      emitter.once(type, callback);
    }
  }

  /**
   * 取消监听器
   * @param type
   * @param callback
   */
  off<T extends "message" | EventType.EventType | MessageType.ChatMessageType>(
    type: T,
    callback: (data: Data<T>) => any
  ) {
    const emitter = this.eventEmitter;
    if (type === "message") {
      this._adaptMessageForAll("off", callback);
    } else {
      emitter.off(type, callback);
    }
  }

  /**
   * 快速回复（只在消息类型包含群组或好友信息时有效）
   * @param msg 发送内容（消息链/纯文本皆可）
   * @param srcMsg 回复哪条消息
   * @param quote 是否引用回复（非聊天消息类型时无效）
   */
  async reply(
    msgChain: string | MessageType.MessageChain,
    srcMsg: EventType.Event | MessageType.ChatMessage,
    quote = false
  ) {
    let messageId = 0;
    let target = 0;
    let type: SendMessageType = "friend";

    if (isChatMessage(srcMsg)) {
      if (quote && srcMsg.messageChain[0].type === "Source") {
        messageId = srcMsg.messageChain[0].id;
      }
    }

    // reply 不同的目标
    switch (srcMsg.type) {
      case "TempMessage":
        return this.api.sendTempMessage(
          msgChain,
          srcMsg.sender.id,
          srcMsg.sender.group.id,
          messageId
        );
      case "FriendMessage":
        type = "friend";
        target = srcMsg.sender.id;
        break;
      case "GroupMessage":
        type = "group";
        target = srcMsg.sender.group.id;
        break;
      case "BotOnlineEvent":
      case "BotOfflineEventActive":
      case "BotOfflineEventForce":
      case "BotOfflineEventDropped":
      case "BotReloginEvent":
        type = "friend";
        target = srcMsg.qq;
        break;
      case "GroupRecallEvent":
      case "BotGroupPermissionChangeEvent":
      case "BotJoinGroupEvent":
      case "GroupNameChangeEvent":
      case "GroupEntranceAnnouncementChangeEvent":
      case "GroupMuteAllEvent":
      case "GroupAllowAnonymousChatEvent":
      case "GroupAllowConfessTalkEvent":
      case "GroupAllowMemberInviteEvent":
        type = "group";
        break;
      case "MemberJoinEvent":
      case "MemberLeaveEventKick":
      case "MemberLeaveEventQuit":
      case "MemberCardChangeEvent":
      case "MemberSpecialTitleChangeEvent":
      case "MemberPermissionChangeEvent":
      case "MemberMuteEvent":
      case "MemberUnmuteEvent":
        type = "group";
        target = srcMsg.member.group.id;
        break;
      case "MemberJoinRequestEvent":
        type = "group";
        target = srcMsg.groupId;
        break;
      default:
        break;
    }

    if (typeof msgChain === "string") {
      const sections = splitText(msgChain);

      if (sections.length > 1) {
        const responses = [];
        for await (const section of sections) {
          const res = await this._sendMessageByType(
            type,
            section,
            target,
            messageId
          );
          responses.push(res);
        }
        return responses;
      }
    }

    return this._sendMessageByType(type, msgChain, target, messageId);
  }

  /**
   * 根据消息类型发送消息
   * @param type
   * @param msgChain
   * @param target
   * @param messageId
   */
  _sendMessageByType(
    type: SendMessageType,
    msgChain: string | MessageType.MessageChain,
    target: number,
    messageId: number
  ) {
    if (type === "friend") {
      return this.api.sendFriendMessage(msgChain, target, messageId);
    } else if (type === "group") {
      return this.api.sendGroupMessage(msgChain, target, messageId);
    }
  }

  /**
   * 为消息和事件类型挂载辅助函数
   * @param msg
   */
  addHelperForMsg(msg: MessageType.ChatMessage | EventType.Event) {
    this.curMsg = msg;
    msg.bubbles = true;
    msg.stopPropagation = () => {
      msg.bubbles = false;
      return msg.bubbles;
    };

    // 消息类型添加直接获取消息内容的参数
    if (
      msg.type === "FriendMessage" ||
      msg.type === "GroupMessage" ||
      msg.type === "TempMessage"
    ) {
      msg.plain = getPlain(msg.messageChain);

      if (msg.type === "GroupMessage") {
        // 添加判断是否被艾特的辅助函数
        msg.isAt = (qq?: number) => {
          return isAt(msg, qq ? qq : this.qq) as boolean;
        };
      }
    }

    // 为各类型添加 reply 辅助函数
    (msg as any).reply = async (
      msgChain: string | MessageType.MessageChain,
      quote = false
    ) => {
      return this.reply(msgChain, msg, quote);
    };

    // 为请求类事件添加 respond 辅助函数
    if (msg.type === "NewFriendRequestEvent") {
      msg.respond = async (
        operate: NewFriendRequestOperationType,
        message?: string
      ) => {
        this.api.resp.newFriendRequest(msg, operate, message);
      };
    } else if (msg.type === "MemberJoinRequestEvent") {
      msg.respond = async (
        operate: MemberJoinRequestOperationType,
        message?: string
      ) => {
        this.api.resp.memberJoinRequest(msg, operate, message);
      };
    } else if (msg.type === "BotInvitedJoinGroupRequestEvent") {
      msg.respond = async (
        operate: BotInvitedJoinGroupRequestOperationType,
        message?: string
      ) => {
        this.api.resp.botInvitedJoinGroupRequest(msg, operate, message);
      };
    }
  }

  /**
   * 处理消息
   * @param msg
   * @param before 在监听器函数执行前执行
   * @param after 在监听器函数执行后执行
   */
  handle(msg: MessageType.ChatMessage | EventType.Event) {
    this.addHelperForMsg(msg);

    this.beforeListener.forEach((cb) => {
      cb(msg);
    });

    if (this.active) {
      const emitter = this.eventEmitter;
      emitter.emit(msg.type, msg);
    }

    this.afterListener.forEach((cb) => {
      cb(msg);
    });

    // 清空当前 curMsg
    delete this.curMsg;
  }

  /**
   * 在监听器函数执行前执行
   */
  before(callback: Function) {
    this.beforeListener.push(callback);
  }

  /**
   * 在监听器函数执行后执行
   */
  after(callback: Function) {
    this.afterListener.push(callback);
  }

  /**
   * 监听消息和事件
   * @param before 在监听器函数执行前执行
   * @param after 在监听器函数执行后执行
   */
  listen() {
    const address = this.mahConfig.host + ":" + this.mahConfig.port;
    if (this.mahConfig.enableWebsocket) {
      this.api.all((msg) => {
        this.handle(msg);
      });
    } else {
      this.logger.info("开始监听: http://" + address);
      let count = 0;
      const intId = setInterval(() => {
        this.api
          .fetchMessage()
          .then((res) => {
            const { data } = res;
            if (data && data.length) {
              count = 0;
              data.forEach((msg) => {
                this.handle(msg);
              });
            }
          })
          .catch((err) => {
            console.error(err.message);
            count++;
            // 失败超过十次
            if (count >= this.retries) {
              clearInterval(intId);
              throw new Error(
                `fetchMessage 已连续 ${this.retries} 次未收到任何消息内容，抛出异常。`
              );
            }
          });
      }, this.interval);
    }
  }
}
