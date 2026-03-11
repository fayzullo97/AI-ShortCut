/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Send, Paperclip, Bot, Image as ImageIcon } from 'lucide-react';

// API Key Gate component
function ApiKeyGate({ children }: { children: React.ReactNode }) {
  const [hasKey, setHasKey] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    checkKey();
  }, []);

  const checkKey = async () => {
    try {
      // @ts-ignore
      const selected = await window.aistudio?.hasSelectedApiKey();
      setHasKey(!!selected);
    } catch (e) {
      console.error(e);
    } finally {
      setIsChecking(false);
    }
  };

  const handleSelectKey = async () => {
    try {
      // @ts-ignore
      await window.aistudio?.openSelectKey();
      setHasKey(true); // Assume success to mitigate race condition
    } catch (e) {
      console.error(e);
      if (e instanceof Error && e.message.includes("Requested entity was not found.")) {
         setHasKey(false);
      }
    }
  };

  if (isChecking) return <div className="flex items-center justify-center h-screen bg-gray-100">Checking API Key...</div>;

  if (!hasKey) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Bot size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">API Key Required</h1>
          <p className="text-gray-600 mb-6">
            This app uses the Gemini 3 Pro Image model, which requires a paid Google Cloud API key.
          </p>
          <button
            onClick={handleSelectKey}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-xl transition-colors"
          >
            Select API Key
          </button>
          <p className="mt-4 text-sm text-gray-500">
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
              Learn more about billing
            </a>
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

type Message = {
  id: string;
  sender: 'user' | 'bot';
  type: 'text' | 'image' | 'generated_image' | 'preset_prompts';
  content?: string;
  imageUrl?: string;
  options?: PresetPrompt[];
  timestamp: Date;
};

type PresetPrompt = {
  id: string;
  label: string;
  prompt: string;
};

const PRESET_PROMPTS: PresetPrompt[] = [
  { id: 'fire', label: 'Make it fire 🔥', prompt: 'Transform the image to make it look like it is made of fire, with bright orange and red flames, glowing embers, and a dark background. High quality, cinematic lighting.' },
  { id: 'cyberpunk', label: 'Cyberpunk 🤖', prompt: 'Convert the image into a cyberpunk style, with neon lights, futuristic city elements, glowing blue and pink colors, and high-tech details. 8k resolution, highly detailed.' },
  { id: 'anime', label: 'Anime Style 🌸', prompt: 'Redraw the image in a high-quality anime style, with vibrant colors, detailed shading, and expressive features. Studio Ghibli style, beautiful scenery.' },
  { id: 'sketch', label: 'Pencil Sketch ✏️', prompt: 'Turn the image into a detailed pencil sketch, with realistic shading, graphite textures, and a hand-drawn look. Fine art, highly detailed.' },
  { id: 'watercolor', label: 'Watercolor 🎨', prompt: 'Transform the image into a beautiful watercolor painting, with soft blended colors, visible brush strokes, and an artistic feel.' }
];

function ChatBot() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'bot',
      type: 'text',
      content: 'Welcome to the Image Gen Bot! 🎨\n\nPlease upload an image to get started.',
      timestamp: new Date()
    }
  ]);
  const [currentUploadedImage, setCurrentUploadedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      
      const newMsgId = Date.now().toString();
      setMessages(prev => [
        ...prev,
        { id: newMsgId, sender: 'user', type: 'image', imageUrl: base64, timestamp: new Date() }
      ]);
      
      setCurrentUploadedImage(base64);

      setTimeout(() => {
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString() + '1',
            sender: 'bot',
            type: 'preset_prompts',
            content: 'Great! Now choose a style for your image:',
            options: PRESET_PROMPTS,
            timestamp: new Date()
          }
        ]);
      }, 500);
    };
    reader.readAsDataURL(file);
    // Reset input value to allow uploading the same file again
    e.target.value = '';
  };

  const handlePresetClick = async (preset: PresetPrompt) => {
    if (!currentUploadedImage) return;

    setMessages(prev => [
      ...prev,
      { id: Date.now().toString(), sender: 'user', type: 'text', content: preset.label, timestamp: new Date() }
    ]);

    setIsGenerating(true);

    try {
      // @ts-ignore
      const apiKey = process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });

      const mimeType = currentUploadedImage.match(/data:(.*?);base64,/)?.[1] || 'image/jpeg';
      const base64Data = currentUploadedImage.replace(/^data:image\/(png|jpeg|webp);base64,/, '');

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            },
            {
              text: preset.prompt,
            },
          ],
        },
      });

      let generatedImageUrl = '';
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          generatedImageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }

      if (generatedImageUrl) {
        setMessages(prev => [
          ...prev,
          { id: Date.now().toString(), sender: 'bot', type: 'generated_image', imageUrl: generatedImageUrl, timestamp: new Date() }
        ]);
      } else {
        throw new Error("No image generated");
      }

    } catch (error) {
      console.error("Generation error:", error);
      setMessages(prev => [
        ...prev,
        { id: Date.now().toString(), sender: 'bot', type: 'text', content: 'Sorry, an error occurred while generating the image. Please try again.', timestamp: new Date() }
      ]);
    } finally {
      setIsGenerating(false);
      setCurrentUploadedImage(null);
      
      setTimeout(() => {
        setMessages(prev => [
          ...prev,
          { id: Date.now().toString() + '1', sender: 'bot', type: 'text', content: 'Want to generate another one? Upload a new image!', timestamp: new Date() }
        ]);
      }, 1000);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex justify-center items-center h-screen bg-gray-200">
      <div className="w-full max-w-md h-full sm:h-[90vh] bg-[#E5DDD5] sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col relative">
        {/* Header */}
        <div className="bg-[#0088cc] text-white p-4 flex items-center gap-3 z-10 shadow-md">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-[#0088cc]">
            <Bot size={24} />
          </div>
          <div>
            <h2 className="font-bold text-lg leading-tight">Image Gen Bot</h2>
            <p className="text-blue-100 text-xs">bot</p>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-cover bg-center" style={{ backgroundImage: "url('https://web.telegram.org/a/chat-bg-pattern-light.png')" }}>
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl p-3 shadow-sm relative ${msg.sender === 'user' ? 'bg-[#EEFFDE] rounded-br-none' : 'bg-white rounded-bl-none'}`}>
                
                {msg.type === 'text' && (
                  <p className="text-gray-800 whitespace-pre-wrap text-[15px] pr-12">{msg.content}</p>
                )}
                
                {msg.type === 'image' && msg.imageUrl && (
                  <div className="relative">
                    <img src={msg.imageUrl} alt="Uploaded" className="rounded-xl max-w-full h-auto" />
                  </div>
                )}

                {msg.type === 'generated_image' && msg.imageUrl && (
                  <div className="space-y-2">
                    <img src={msg.imageUrl} alt="Generated" className="rounded-xl max-w-full h-auto" />
                    <p className="text-xs text-gray-500 text-right pr-12">Generated by Nano Banana Pro</p>
                  </div>
                )}

                {msg.type === 'preset_prompts' && (
                  <div className="space-y-3">
                    <p className="text-gray-800 text-[15px] pr-12">{msg.content}</p>
                    <div className="flex flex-col gap-2">
                      {msg.options?.map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => handlePresetClick(opt)}
                          disabled={isGenerating || !currentUploadedImage}
                          className="bg-[#0088cc] hover:bg-[#0077b3] disabled:bg-gray-400 text-white py-2 px-4 rounded-xl text-sm font-medium transition-colors text-left flex items-center justify-between"
                        >
                          <span>{opt.label}</span>
                          <Send size={14} className="opacity-70" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                
                <span className={`text-[10px] text-gray-400 absolute bottom-1.5 right-2 ${msg.type === 'image' || msg.type === 'generated_image' ? 'bg-black/30 text-white px-1.5 rounded-full bottom-2 right-2' : ''}`}>
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </div>
          ))}
          
          {isGenerating && (
            <div className="flex justify-start">
              <div className="bg-white rounded-2xl rounded-bl-none p-4 shadow-sm flex items-center gap-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <span className="text-sm text-gray-500">Generating image...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="bg-white p-3 flex items-center gap-2 z-10">
          <label className={`p-2 rounded-full cursor-pointer transition-colors ${isGenerating || currentUploadedImage ? 'text-gray-300' : 'text-gray-500 hover:text-[#0088cc] hover:bg-gray-100'}`}>
            <Paperclip size={24} />
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              onChange={handleImageUpload}
              disabled={isGenerating || !!currentUploadedImage}
            />
          </label>
          <div className="flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-gray-500 text-sm">
            {currentUploadedImage ? 'Choose a style above...' : 'Upload an image to start...'}
          </div>
          <button disabled className="p-2 text-gray-300 rounded-full">
            <Send size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ApiKeyGate>
      <ChatBot />
    </ApiKeyGate>
  );
}
