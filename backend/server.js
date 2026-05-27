require("dotenv").config({quiet: true});
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB Error:", err));

// 1. TODO: Tạo Schema
const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Tên không được để trống'],
        minlength: [2, 'Tên phải có ít nhất 2 ký tự'],
        trim: true
    },
    age: {
        type: Number,
        required: [true, 'Tuổi không được để trống'],
        min: [0, 'Tuổi phải >= 0']
    },
    email: {
        type: String,
        required: [true, 'Email không được để trống'],
        match: [/^\S+@\S+\.\S+$/, 'Email không hợp lệ'],
        trim: true,
        unique: true
    },
    address: {
        type: String,
        trim: true
    }
},{ timestamps: true });

const User = mongoose.model("User", UserSchema);

// Health Check Endpoint - Kiểm tra kết nối Database
app.get("/api/health", (req, res) => {
    const dbStatus = mongoose.connection.readyState; // 0: disconnected, 1: connected, 2: connecting, 3: disconnecting
    const isConnected = dbStatus === 1;
    
    if (isConnected) {
        res.status(200).json({ 
            status: "ok",
            message: "Server và Database kết nối bình thường",
            database: "connected",
            timestamp: new Date().toISOString()
        });
    } else {
        const statusNames = {
            0: "disconnected",
            2: "connecting",
            3: "disconnecting"
        };
        res.status(503).json({ 
            status: "error",
            message: "Database không khả dụng",
            database: statusNames[dbStatus] || "unknown",
            timestamp: new Date().toISOString()
        });
    }
});

app.get("/", (req, res) => {
    res.status(200).json({
        status: "success",
        message: "API Server IT4409 (User Management Backend)",
        endpoints: {
            healthCheck: "/api/health",
            users: "/api/users"
        },
        timestamp: new Date().toISOString()
    });
});

// 2. TODO: Implement API endpoints
app.get("/api/users", async (req, res) => {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 5;

        if (page < 1) page = 1;
        if (limit < 1) limit = 5;
        if (limit > 50) limit = 50;

        const search = req.query.search ? req.query.search.trim() : "";
        const filter = search
            ? {
                $or: [
                    { name: { $regex: search, $options: "i" } },
                    { email: { $regex: search, $options: "i" } },
                    { address: { $regex: search, $options: "i" } }
                ]
            }
            : {};

        const skip = (page - 1) * limit;

        // Sử dụng promise.all để chạy song song 2 query
        const [users, total] = await Promise.all([
            User.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit),
            User.countDocuments(filter)
        ]);

        const totalPages = Math.ceil(total / limit);

        res.status(200).json({ page, limit, total, totalPages, data: users });
    } catch (err) {
        const errorMsg = `❌ GET /api/users - Error: ${err.message}`;
        console.error(`[${new Date().toISOString()}] ${errorMsg}`);
        console.error("Stack trace:", err.stack);
        res.status(500).json({ 
            status: "error",
            code: 500,
            message: "Lỗi Server: Không thể lấy danh sách người dùng",
            details: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.post("/api/users", async (req, res) => {
    try {
        const { name, age, email, address } = req.body;
        
        // Validate required fields
        if (!name || !age || !email) {
            console.warn(`[${new Date().toISOString()}] ⚠️  POST /api/users - Validation failed: Missing required fields`);
            return res.status(400).json({ 
                status: "error",
                code: 400,
                message: "Dữ liệu không hợp lệ",
                details: "Các trường bắt buộc: name, age, email",
                timestamp: new Date().toISOString()
            });
        }
        
        const newUser = await User.create({ name, age, email, address });
        console.log(`✅ POST /api/users - User created: ${newUser._id}`);
        res.status(201).json({ 
            message: "Tạo người dùng thành công", 
            data: newUser 
        });
    } catch (err) {
        // Handle validation errors
        if (err.name === "ValidationError") {
            const messages = Object.values(err.errors).map(e => e.message);
            console.error(`[${new Date().toISOString()}] ❌ POST /api/users - Validation Error: ${messages.join(", ")}`);
            return res.status(400).json({ 
                status: "error",
                code: 400,
                message: "Dữ liệu không hợp lệ",
                details: messages,
                timestamp: new Date().toISOString()
            });
        }
        
        // Handle duplicate email
        if (err.code === 11000) {
            console.error(`[${new Date().toISOString()}] ❌ POST /api/users - Duplicate Email: ${err.keyValue?.email}`);
            return res.status(400).json({ 
                status: "error",
                code: 400,
                message: "Email đã tồn tại",
                details: `Email ${err.keyValue?.email} đã được sử dụng`,
                timestamp: new Date().toISOString()
            });
        }
        
        console.error(`[${new Date().toISOString()}] ❌ POST /api/users - Error: ${err.message}`);
        console.error("Stack trace:", err.stack);
        res.status(500).json({ 
            status: "error",
            code: 500,
            message: "Lỗi Server: Không thể tạo người dùng",
            details: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.put("/api/users/:id", async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            console.warn(`[${new Date().toISOString()}] ⚠️  PUT /api/users/:id - Invalid ID: ${id}`);
            return res.status(400).json({ 
                status: "error",
                code: 400,
                message: "ID không hợp lệ",
                details: `ID '${id}' không phải là ObjectId hợp lệ`,
                timestamp: new Date().toISOString()
            });
        }

        // Chỉ cập nhật các trường có gửi lên
        const updateData = {};
        const fields = ['name', 'age', 'email', 'address'];
        fields.forEach(field => {
            if (req.body[field] !== undefined) {
                updateData[field] = req.body[field];
            }
        });

        const updatedUser = await User.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            console.warn(`[${new Date().toISOString()}] ⚠️  PUT /api/users/:id - User not found: ${id}`);
            return res.status(404).json({ 
                status: "error",
                code: 404,
                message: "Không tìm thấy người dùng",
                details: `Người dùng với ID '${id}' không tồn tại`,
                timestamp: new Date().toISOString()
            });
        }
        
        console.log(`✅ PUT /api/users/:id - User updated: ${id}`);
        res.status(200).json({ 
            message: "Cập nhật người dùng thành công", 
            data: updatedUser 
        });
    } catch (err) {
        // Handle validation errors
        if (err.name === "ValidationError") {
            const messages = Object.values(err.errors).map(e => e.message);
            console.error(`[${new Date().toISOString()}] ❌ PUT /api/users/:id - Validation Error: ${messages.join(", ")}`);
            return res.status(400).json({ 
                status: "error",
                code: 400,
                message: "Dữ liệu không hợp lệ",
                details: messages,
                timestamp: new Date().toISOString()
            });
        }
        
        // Handle duplicate email
        if (err.code === 11000) {
            console.error(`[${new Date().toISOString()}] ❌ PUT /api/users/:id - Duplicate Email: ${err.keyValue?.email}`);
            return res.status(400).json({ 
                status: "error",
                code: 400,
                message: "Email đã tồn tại",
                details: `Email ${err.keyValue?.email} đã được sử dụng`,
                timestamp: new Date().toISOString()
            });
        }
        
        console.error(`[${new Date().toISOString()}] ❌ PUT /api/users/:id - Error: ${err.message}`);
        console.error("Stack trace:", err.stack);
        res.status(500).json({ 
            status: "error",
            code: 500,
            message: "Lỗi Server: Không thể cập nhật người dùng",
            details: err.message,
            timestamp: new Date().toISOString()
        });
    }
});
app.delete("/api/users/:id", async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            console.warn(`[${new Date().toISOString()}] ⚠️  DELETE /api/users/:id - Invalid ID: ${id}`);
            return res.status(400).json({ 
                status: "error",
                code: 400,
                message: "ID người dùng không hợp lệ",
                details: `ID '${id}' không phải là ObjectId hợp lệ`,
                timestamp: new Date().toISOString()
            });
        }

        const deletedUser = await User.findByIdAndDelete(id);

        if (!deletedUser) {
            console.warn(`[${new Date().toISOString()}] ⚠️  DELETE /api/users/:id - User not found: ${id}`);
            return res.status(404).json({ 
                status: "error",
                code: 404,
                message: "Không tìm thấy người dùng",
                details: `Người dùng với ID '${id}' không tồn tại`,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`✅ DELETE /api/users/:id - User deleted: ${id}`);
        res.status(200).json({ 
            message: "Xóa người dùng thành công",
            data: deletedUser
        });
    } catch (err) {
        console.error(`[${new Date().toISOString()}] ❌ DELETE /api/users/:id - Error: ${err.message}`);
        console.error("Stack trace:", err.stack);
        res.status(500).json({ 
            status: "error",
            code: 500,
            message: "Lỗi Server: Không thể xóa người dùng",
            details: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

// 404 handler for unknown routes
app.use((req, res) => {
    console.warn(`[${new Date().toISOString()}] ⚠️  404 Not Found: ${req.method} ${req.path}`);
    res.status(404).json({ 
        status: "error",
        code: 404,
        message: "Endpoint không tồn tại",
        details: `${req.method} ${req.path} không được tìm thấy`,
        timestamp: new Date().toISOString()
    });
});

// Global error handling middleware
app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] ❌ Global Error Handler - ${err.message}`);
    console.error("Stack trace:", err.stack);
    
    const statusCode = err.status || 500;
    const message = statusCode === 500 ? "Lỗi Server nội bộ" : err.message;
    
    res.status(statusCode).json({ 
        status: "error",
        code: statusCode,
        message: message,
        details: err.message,
        timestamp: new Date().toISOString()
    });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on https://it4409-be-user-crud-2.onrender.com:${PORT}`);
});