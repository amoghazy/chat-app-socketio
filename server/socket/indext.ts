import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import getUserData from "../utils/getUserData";
import User from "../models/userModel";
import IDataMessage from "./../../client/src/types/IMessageData";
import uploadMediaMessageToCloudinary from "./uploadMessageMediacloudinary";
import Conversation from "../models/converstionModel";
import Message from "../models/messageModel";
import { send } from "process";
import getConverstions from "../utils/getUserConvs";

const app = express();
const server = http.createServer(app);
dotenv.config();
const io = new Server(server, {
  cors: {
    credentials: true,
    origin: process.env.CLIENT_URL,
  },
});
const onlineUsers = new Set();
io.on("connection", async (socket) => {
  console.log("new user connected", socket.id);
  const token = socket.handshake.auth.token;
  const user: any = await getUserData(token);

  if (token) {
    console.log("user connected", user?.email);
    socket.join(user?._id?.toString());
    onlineUsers.add(user?._id?.toString());
    io.emit("onlineUsers", Array.from(onlineUsers));
    socket.on("sidebar", async (userID) => {
      const converstions = await getConverstions(userID);

      socket.emit("converstions", converstions ?? []);
    });
    socket.on("message-page", async (userId) => {
      const userTomessage = await User.findById(userId).select(
        "-password -__v"
      );
      const payload = {
        name: userTomessage?.name,
        email: userTomessage?.email,
        profilePic: userTomessage?.profilePic,
        online: onlineUsers.has(userTomessage?._id?.toString()),
        id: userTomessage?._id,
      };

      socket.emit("message-user", payload);

      //get previous message
      let converstionPrevious = await Conversation.findOne({
        $or: [
          {
            sender: user?._id,
            receiver: userTomessage?._id,
          },
          {
            receiver: user?._id,
            sender: userTomessage?._id,
          },
        ],
      })
        .populate("messages")
        .sort({ createdAt: -1 });

      socket.emit("previous-message", converstionPrevious?.messages ?? []);
    });

    socket.on("new-message", async (message: IDataMessage) => {
      let converstion = await Conversation.findOne({
        $or: [
          {
            sender: user?._id,
            receiver: message.reciver,
          },
          {
            receiver: user?._id,
            sender: message.reciver,
          },
        ],
      });

      if (!converstion) {
        const creatConverstion = new Conversation({
          sender: user?._id,
          receiver: message.reciver,
          messages: [],
        });
        converstion = await creatConverstion.save();
      }
      if (message.image || message.video || message.pdf) {
        const url = await uploadMediaMessageToCloudinary(
          (message.image as Buffer) ||
            (message.video as Buffer) ||
            (message.pdf as Buffer)
        );
        message.image
          ? (message.image = url)
          : message.video
          ? (message.video = url)
          : (message.pdf = url);
      }
      const newMessage = new Message({
        text: message.messageText,
        msgBy: message.sender,
        imageURL: message.image,
        videoURL: message.video,
        pdfURL: message.pdf,
      });
      const savedMessage = await newMessage.save();
      const updatedConverstion = await Conversation.findByIdAndUpdate(
        { _id: converstion?._id },
        {
          $push: {
            messages: savedMessage?._id,
          },
        }
      );
      const getConverstionMessages = await Conversation.findOne({
        $or: [
          {
            sender: user?._id,
            receiver: message.reciver,
          },
          {
            receiver: user?._id,
            sender: message.reciver,
          },
        ],
      })
        .populate("messages")
        .sort({ createdAt: -1 });
      io.to(message.reciver).emit(
        "get-messages",
        getConverstionMessages?.messages
      );
      io.to(message.sender).emit(
        "get-messages",
        getConverstionMessages?.messages
      );
      const converstionsSender = await getConverstions(message.sender);
      const converstionsReciever = await getConverstions(message.reciver);

      io.to(message.reciver).emit("converstions", converstionsReciever);
      io.to(message.sender).emit("converstions", converstionsSender);
    });
    socket.on("seen", async (userId) => {
      console.log("seen", userId);
      console.log("user", user?._id?.toString());
      const converstion = await Conversation.findOne({
        $or: [
          {
            sender: user?._id,
            receiver: userId,
          },
          {
            receiver: user?._id,
            sender: userId,
          },
        ],
      });
      if (!converstion) {
        console.log("Conversation not found");
        return;
      }

      const updatedMessages = await Message.updateMany(
        { _id: { $in: converstion?.messages } ,msgBy: userId},
        { seen: true },
        { new: true }
      );
    

      const converstionsSender = await getConverstions(user?._id?.toString());
      const converstionsReciever = await getConverstions(userId);
      io.to(userId).emit("converstions", converstionsReciever);
      io.to(user?._id?.toString()).emit("converstions", converstionsSender);
    });
    socket.on("disconnect", () => {
      console.log("user disconnected", user?.email);
      onlineUsers.delete(user?._id?.toString());
      console.log(onlineUsers, "after dicconnect");
    });
  }
});
export { server, app };
