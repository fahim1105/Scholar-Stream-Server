// scholar_stream_db
// q1i72QgjY6hBbJHO

const express = require('express')
const cors = require('cors')
const app = express()

require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000


// Firebase admin SDK
const admin = require("firebase-admin");

const serviceAccount = require("./scholarstream-firebase-admin-sdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

app.use(express.json());
app.use(cors());

const VerifyFirebaseToken = async (req, res, next) => {
    // console.log('headers in middle ware', req.headers?.authorization)
    const Token = req.headers.authorization;

    if (!Token) {
        return res.status(401).send({ message: 'Unauthorized access' })
    }
    try {
        const tokenId = Token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(tokenId);
        console.log('Decoded in the token', decoded);
        req.decoded_email = decoded.email;

        next()
    }
    catch (err) {
        return res.status(401).send({ message: "Unauthorized access" });
    }
}


const uri = `mongodb+srv://${process.env.DB_user}:${process.env.DB_pass}@cluster0.mcccn4v.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const db = client.db('scholar_stream_db');
        const scholarshipsCollection = db.collection('scholarships');
        const reviewsCollection = db.collection('reviews');
        const usersCollection = db.collection('users');
        const paymentCollection = db.collection('payments');
        const applicationsCollection = db.collection('applications');
        const BlogsCollection = db.collection("blogs");
        const TopersCollection = db.collection("toppers");

        // middleWare with database access >> admin before allowing admin activity
        // Must be used after VerifyFirebaseToken middleWare
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                res.send({ message: "Forbidden access" })
            }

            next()
        }

        const verifyModerator = async (req, res, next) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });

            if (!user || (user.role !== 'moderator' && user.role !== 'admin')) {
                return res.status(403).send({ message: "Forbidden" });
            }
            next();
        };


        // API's here

        // Topers related APIs

        app.post('/toppers', VerifyFirebaseToken, verifyModerator, async (req, res) => {
            const blog = req.body;
            blog.createdAt = new Date();
            const result = await TopersCollection.insertOne(blog);
            res.send(result);
        });

        app.get('/toppers', async (req, res) => {
            const result = await TopersCollection.find().sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        app.delete('/toppers/:id', VerifyFirebaseToken, verifyModerator, async (req, res) => {
            const id = req.params.id;
            const result = await TopersCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        app.patch('/toppers/:id', VerifyFirebaseToken, verifyModerator, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    name: req.body.name,          // title এর বদলে name
                    university: req.body.university, // category এর বদলে university
                    scholarship: req.body.scholarship,
                    batch: req.body.batch,
                    image: req.body.image,
                    updatedAt: new Date()
                }
            };
            const result = await TopersCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        // Blog Related APIS

        app.post('/blogs', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const blog = req.body;
            blog.createdAt = new Date();
            const result = await BlogsCollection.insertOne(blog);
            res.send(result);
        });

        app.get('/blogs', async (req, res) => {
            const result = await BlogsCollection.find().sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        app.delete('/blogs/:id', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const result = await BlogsCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        app.patch('/blogs/:id', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    title: req.body.title,
                    category: req.body.category,
                    image: req.body.image,
                    description: req.body.description,
                    updatedAt: new Date() // Tracking update time
                }
            };
            const result = await BlogsCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        // User Related API's

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };

            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: "User already exists" });
            }

            user.role = "student";
            user.createdAt = new Date();
            user.status = "active";

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 20;
                const skip = (page - 1) * limit;

                const totalItems = await usersCollection.countDocuments();
                const result = await usersCollection.find()
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.send({
                    users: result,
                    totalItems,
                    totalPages: Math.ceil(totalItems / limit),
                    currentPage: page
                });
            } catch (error) {
                res.status(500).send({ message: "Failed to load users" });
            }
        });

        app.get('/users/:email/role', VerifyFirebaseToken, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            res.send({ role: user?.role || 'student' });
        });

        // Get current logged-in user info
        app.get('/users/me', VerifyFirebaseToken, async (req, res) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });
            res.send(user);
        });

        app.patch('/users/role/:id', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { role } = req.body;

            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role } }
            );

            res.send(result);
        });

        app.delete('/users/:id', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const result = await usersCollection.deleteOne({
                _id: new ObjectId(id)
            });

            res.send(result);
        });

        app.get('/admin/analytics', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            // ১. টোটাল কাউন্টসমূহ
            const totalUsers = await usersCollection.estimatedDocumentCount();
            const totalScholarships = await scholarshipsCollection.estimatedDocumentCount();

            // ২. পাই চার্টের জন্য ইউজার রোল ডিস্ট্রিবিউশন
            const userRoleStats = await usersCollection.aggregate([
                {
                    $group: {
                        _id: "$role",
                        value: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        name: "$_id", // যেমন: admin, moderator, student
                        value: 1
                    }
                }
            ]).toArray();

            // ৩. টোটাল পেমেন্ট ক্যালকুলেশন
            const payments = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalFees: { $sum: "$amount" }
                    }
                }
            ]).toArray();

            res.send({
                totalUsers,
                totalScholarships,
                totalFees: payments[0]?.totalFees || 0,
                userRoleStats // এটি ফ্রন্টএন্ডে পাই চার্টে যাবে
            });
        });

        app.get('/admin/application-stats', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const stats = await scholarshipsCollection.aggregate([
                {
                    $group: {
                        _id: "$scholarshipCategory",
                        applications: { $sum: "$appliedCount" }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        category: "$_id",
                        applications: 1
                    }
                },
                { $sort: { applications: -1 } } // বেশি অ্যাপ্লিকেশনগুলো আগে আসবে
            ]).toArray();

            res.send(stats);
        });


        // User Overview API for Student Dashboard
        app.get('/user-overview', VerifyFirebaseToken, async (req, res) => {
            const email = req.decoded_email;

            try {
                // ১. ইউজারের বেসিক ইনফো (রোল, নাম, ছবি)
                const user = await usersCollection.findOne({ email });

                // ২. ইউজার কতগুলো স্কলারশিপে অ্যাপ্লাই করেছে (পেমেন্ট সাকসেসফুল গুলো)
                const appliedCount = await applicationsCollection.countDocuments({
                    userEmail: email,
                    paymentStatus: "paid"
                });

                // ৩. ইউজার টোটাল কত টাকা খরচ করেছে
                const payments = await paymentCollection.aggregate([
                    { $match: { userEmail: email } },
                    {
                        $group: {
                            _id: null,
                            totalSpent: { $sum: "$amount" }
                        }
                    }
                ]).toArray();

                // ৪. ইউজার কতগুলো রিভিউ দিয়েছে
                const reviewsCount = await reviewsCollection.countDocuments({
                    reviewerEmail: email
                });

                // ৫. রিসেন্ট কিছু অ্যাপ্লিকেশন (সর্বশেষ ৩টি)
                const recentApplications = await applicationsCollection.find({
                    userEmail: email,
                    paymentStatus: "paid"
                })
                    .sort({ appliedAt: -1 })
                    .limit(3)
                    .toArray();

                res.send({
                    userName: user?.displayName || "User",
                    userPhoto: user?.photoURL,
                    totalApplied: appliedCount,
                    totalSpent: payments[0]?.totalSpent || 0,
                    totalReviews: reviewsCount,
                    recentApplications
                });

            } catch (error) {
                console.error("Overview Error:", error);
                res.status(500).send({ message: "Failed to fetch overview data" });
            }
        });


        //    Scholarship Related API's

        app.get('/scholarships', async (req, res) => {
            try {
                const { search, category, subject, degree, page = 1, limit = 20 } = req.query;

                const query = {};
                if (search) {
                    query.$or = [
                        { scholarshipName: { $regex: search, $options: 'i' } },
                        { universityName: { $regex: search, $options: 'i' } },
                        { degree: { $regex: search, $options: 'i' } },
                    ];
                }
                if (category) query.scholarshipCategory = category;
                if (subject) query.subjectCategory = subject;
                if (degree) query.degree = degree;

                const skip = (parseInt(page) - 1) * parseInt(limit);

                const totalItems = await scholarshipsCollection.countDocuments(query);

                const result = await scholarshipsCollection.find(query)
                    .skip(skip)
                    .limit(parseInt(limit))
                    .toArray();

                res.send({
                    scholarships: result,
                    totalItems,
                    totalPages: Math.ceil(totalItems / limit),
                    currentPage: parseInt(page)
                });
            } catch (error) {
                res.status(500).send({ message: "Failed to load scholarships" });
            }
        });

        app.get('/scholarships/top', async (req, res) => {
            try {
                const result = await scholarshipsCollection
                    .find()
                    .sort({ applicationFees: 1 })
                    .limit(6)
                    .toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to load scholarships" });
            }
        });

        app.get('/scholarships/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await scholarshipsCollection.findOne(query);
            res.send(result);
        });

        app.post('/scholarships', async (req, res) => {
            try {
                const scholarship = req.body;
                const result = await scholarshipsCollection.insertOne(scholarship);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to add scholarship" });
            }
        });

        app.delete("/scholarships/:id",VerifyFirebaseToken,verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const result = await scholarshipsCollection.deleteOne({
                _id: new ObjectId(id),
            });

            res.send(result);
        });

        app.patch("/scholarships/:id",VerifyFirebaseToken,verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            const result = await scholarshipsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedData }
            );

            res.send(result);
        });


        // Payment Related API's

        // app.post('/create-checkout-session', VerifyFirebaseToken, async (req, res) => {
        //     try {
        //         const { scholarshipId, userName, userEmail, universityName, scholarshipName } = req.body;

        //         // ১. স্কলারশিপের তথ্য চেক করা
        //         const scholarship = await scholarshipsCollection.findOne({
        //             _id: new ObjectId(scholarshipId)
        //         });

        //         if (!scholarship) {
        //             return res.status(404).send({ message: "Scholarship not found" });
        //         }

        //         // ২. ক্লিক করার সাথে সাথে applicationsCollection-এ একটি 'pending' এন্ট্রি তৈরি
        //         const initialApplication = {
        //             scholarshipId: new ObjectId(scholarshipId),
        //             scholarshipName: scholarship.scholarshipName,
        //             universityName: scholarship.universityName,
        //             userName: userName, // ফ্রন্টএন্ড থেকে পাঠানো
        //             userEmail: userEmail || req.decoded_email, // সেফটির জন্য দুইটাই চেক করা
        //             amountPaid: 0,
        //             paymentStatus: "pending", // পেমেন্ট না হওয়া পর্যন্ত এটি পেন্ডিং থাকবে
        //             status: "pending", // মডারেটর স্ট্যাটাস
        //             appliedAt: new Date(),
        //             feedback: ""
        //         };

        //         const applicationResult = await applicationsCollection.insertOne(initialApplication);
        //         const applicationId = applicationResult.insertedId;

        //         // ৩. স্ট্রাইপ সেশন তৈরি
        //         const amount = (scholarship.applicationFees + scholarship.serviceCharge) * 100;

        //         const session = await stripe.checkout.sessions.create({
        //             payment_method_types: ['card'],
        //             line_items: [
        //                 {
        //                     price_data: {
        //                         currency: 'usd',
        //                         unit_amount: amount,
        //                         product_data: {
        //                             name: scholarship.scholarshipName,
        //                             description: scholarship.universityName
        //                         }
        //                     },
        //                     quantity: 1
        //                 }
        //             ],
        //             customer_email: req.decoded_email,
        //             mode: 'payment',
        //             metadata: {
        //                 applicationId: applicationId.toString(), // পেমেন্ট সাকসেস রুটে এটি লাগবে
        //                 scholarshipId: scholarshipId.toString(),
        //                 scholarshipName: scholarship.scholarshipName,
        //                 universityName: scholarship.universityName, // এটি যোগ করা হয়েছে
        //                 userEmail: userEmail || req.decoded_email    // এটি যোগ করা হয়েছে
        //             },
        //             success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        //             cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`
        //         });

        //         res.send({ url: session.url });
        //     } catch (error) {
        //         console.error("Stripe Session Error:", error);
        //         res.status(500).send({ message: "Internal Server Error" });
        //     }
        // });

        app.post('/create-checkout-session', VerifyFirebaseToken, async (req, res) => {
            try {
                const { scholarshipId, userName, userEmail } = req.body;

                // ১. ডাটাবেজ থেকে স্কলারশিপের লেটেস্ট তথ্য আনা
                const scholarship = await scholarshipsCollection.findOne({
                    _id: new ObjectId(scholarshipId)
                });

                if (!scholarship) {
                    return res.status(404).send({ message: "Scholarship not found" });
                }

                // ২. অ্যামাউন্ট ক্যালকুলেশন (String concatenation ফিক্স করা হয়েছে)
                // parseFloat নিশ্চিত করে যে "20" + "10" যেন "2010" না হয়ে ৩০ হয়
                const appFee = parseFloat(scholarship.applicationFees) || 0;
                const serviceFee = parseFloat(scholarship.serviceCharge) || 0;
                const totalAmount = appFee + serviceFee;

                // স্ট্রাইপ সেন্ট (Cents) হিসেবে টাকা নেয়, তাই ১০০ দিয়ে গুণ
                const amountInCents = Math.round(totalAmount * 100);

                // ৩. applicationsCollection-এ পেমেন্ট শুরুর আগেই একটি রেকর্ড তৈরি (সব ইনফরমেশন সহ)
                const initialApplication = {
                    scholarshipId: new ObjectId(scholarshipId),
                    scholarshipName: scholarship.scholarshipName,
                    universityName: scholarship.universityName,
                    universityImage: scholarship.universityImage, // ছবি মিস হবে না
                    subjectCategory: scholarship.subjectCategory,
                    degree: scholarship.degree,
                    universityCity: scholarship.universityCity,
                    universityCountry: scholarship.universityCountry,
                    scholarshipCategory: scholarship.scholarshipCategory,
                    userName: userName,
                    userEmail: userEmail || req.decoded_email,
                    applicationFees: appFee,
                    serviceCharge: serviceFee,
                    amountPaid: totalAmount,
                    paymentStatus: "pending",
                    status: "pending",
                    appliedAt: new Date(),
                    feedback: ""
                };

                const applicationResult = await applicationsCollection.insertOne(initialApplication);
                const applicationId = applicationResult.insertedId;

                // ৪. স্ট্রাইপ সেশন তৈরি
                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                unit_amount: amountInCents, // সংশোধিত সঠিক অ্যামাউন্ট
                                product_data: {
                                    name: scholarship.scholarshipName,
                                    description: `University: ${scholarship.universityName}`,
                                    images: [scholarship.universityImage].filter(Boolean) // যদি ইমেজ থাকে
                                }
                            },
                            quantity: 1
                        }
                    ],
                    customer_email: req.decoded_email,
                    mode: 'payment',
                    metadata: {
                        applicationId: applicationId.toString(),
                        scholarshipId: scholarshipId.toString(),
                        scholarshipName: scholarship.scholarshipName,
                        userEmail: userEmail || req.decoded_email
                    },
                    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}&app_id=${applicationId}`,
                    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`
                });

                res.send({ url: session.url });
            } catch (error) {
                console.error("Stripe Session Error:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        app.patch('/scholarship-payment-success', async (req, res) => {
            try {
                const sessionId = req.query.session_id;
                const session = await stripe.checkout.sessions.retrieve(sessionId);

                if (session.payment_status === 'paid') {
                    // ১. মেটাডাটা থেকে সব তথ্য নেওয়া (নিশ্চিত করুন create-checkout-session এ এগুলো পাঠিয়েছেন)
                    const { applicationId, scholarshipId, scholarshipName, universityName, userEmail } = session.metadata;
                    const transactionId = session.payment_intent;
                    const amountPaid = session.amount_total / 100;

                    // ২. অ্যাপ্লিকেশন আপডেট করা
                    await applicationsCollection.updateOne(
                        { _id: new ObjectId(applicationId) },
                        {
                            $set: {
                                paymentStatus: "paid",
                                transactionId: transactionId,
                                amountPaid: amountPaid,
                                paidAt: new Date()
                            }
                        }
                    );

                    // ৩. স্কলারশিপের অ্যাপ্লাইড কাউন্ট বাড়ানো
                    await scholarshipsCollection.updateOne(
                        { _id: new ObjectId(scholarshipId) },
                        { $inc: { appliedCount: 1 } }
                    );

                    // ৪. পেমেন্ট কালেকশনে ডাটা পাঠানো (আপনার ডেমো অনুযায়ী)
                    const paymentRecord = {
                        scholarshipId: scholarshipId,
                        scholarshipName: scholarshipName,
                        userEmail: userEmail, // এটি ফিল্টার করার জন্য খুবই গুরুত্বপূর্ণ
                        amount: amountPaid,
                        transactionId: transactionId,
                        paymentStatus: "paid",
                        paidAt: new Date()
                    };

                    await paymentCollection.insertOne(paymentRecord);

                    // ৫. ফ্রন্টএন্ডের জন্য সাকসেস রেসপন্স
                    res.send({
                        success: true,
                        transactionId,
                        scholarshipName,
                        universityName: universityName || "University",
                        amountPaid
                    });
                }
            } catch (error) {
                console.error("Payment Success Error:", error);
                res.status(500).send({ success: false, message: "Internal Server Error" });
            }
        });

        app.get('/payments', VerifyFirebaseToken, async (req, res) => {
            try {
                const email = req.query.email;
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 20;
                const skip = (page - 1) * limit;

                const query = {};
                if (email) {
                    query.userEmail = email;
                    if (email !== req.decoded_email) {
                        return res.status(403).send({ message: "Forbidden access" });
                    }
                }

                const totalItems = await paymentCollection.countDocuments(query);
                const result = await paymentCollection.find(query)
                    .sort({ paidAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.send({
                    payments: result,
                    totalItems,
                    totalPages: Math.ceil(totalItems / limit),
                    currentPage: page
                });
            } catch (error) {
                res.status(500).send({ message: "Internal server error" });
            }
        });

        app.delete('/payments', async (req, res) => {
            // const id = req.params.id;
            // const query = { _id: new ObjectId(id) };

            const result = await paymentCollection.deleteMany();
            res.send(result);
        })

        app.delete('/payments/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const result = await paymentCollection.deleteOne(query);
            res.send(result);
        })

        // Application >> moderator

        app.get('/applications', VerifyFirebaseToken, async (req, res) => {
            try {
                const email = req.query.email;
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 20;
                const skip = (page - 1) * limit;

                // Security Check
                if (req.decoded_email && email !== req.decoded_email) {
                    return res.status(403).send({ message: 'Forbidden access' });
                }

                let query = {};
                if (email) {
                    query = { userEmail: email };
                }

                const totalItems = await applicationsCollection.countDocuments(query);
                const result = await applicationsCollection.find(query)
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.send({
                    applications: result,
                    totalItems,
                    totalPages: Math.ceil(totalItems / limit),
                    currentPage: page
                });
            } catch (error) {
                res.status(500).send({ message: "Failed to load applications" });
            }
        });


        app.get('/moderator/applications', VerifyFirebaseToken, verifyModerator, async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 20;
                const skip = (page - 1) * limit;

                const query = { paymentStatus: "paid" };

                // মোট কতটি আবেদন আছে তা গণনা করা
                const totalItems = await applicationsCollection.countDocuments(query);

                const result = await applicationsCollection
                    .find(query)
                    .sort({ appliedAt: 1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.send({
                    applications: result,
                    totalItems,
                    totalPages: Math.ceil(totalItems / limit),
                    currentPage: page
                });
            } catch (error) {
                res.status(500).send({ message: "Internal server error" });
            }
        });

        // 1. Application (Processing, Completed, Rejected) for update
        app.patch('/moderator/application-status/:id', VerifyFirebaseToken, verifyModerator, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;

            try {
                const result = await applicationsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: status } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "Application not found" });
                }

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        // 2. Application feedback update
        app.patch('/moderator/application-feedback/:id', VerifyFirebaseToken, verifyModerator, async (req, res) => {
            const id = req.params.id;
            const { feedback } = req.body;

            try {
                const result = await applicationsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { feedback: feedback } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "Application not found" });
                }

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        app.patch('/applications/:id', VerifyFirebaseToken, async (req, res) => {
            try {
                const id = req.params.id;
                const decodedEmail = req.decoded_email; // from token
                const { phoneNumber, address } = req.body;

                // cheacking user info ans status is pending
                const application = await applicationsCollection.findOne({
                    _id: new ObjectId(id),
                    userEmail: decodedEmail
                });

                if (!application) {
                    return res.status(404).send({ message: "Application not found or unauthorized" });
                }

                if (application.status !== 'pending') {
                    return res.status(403).send({ message: "Only pending applications can be edited" });
                }

                // update data
                const result = await applicationsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            phoneNumber: phoneNumber,
                            address: address,
                            lastModified: new Date() // track
                        }
                    }
                );

                res.send(result);
            } catch (error) {
                console.error("Update Application Error:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        app.delete('/applications/:id', VerifyFirebaseToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await applicationsCollection.deleteOne(query);

            res.send(result);
        });

        // Reviews Related API's

        app.get('/all-reviews', VerifyFirebaseToken, verifyModerator, async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 20;
                const skip = (page - 1) * limit;

                // মোট কতটি রিভিউ আছে তা চেক করা
                const totalItems = await reviewsCollection.countDocuments();

                const result = await reviewsCollection
                    .find()
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.send({
                    reviews: result,
                    totalItems,
                    totalPages: Math.ceil(totalItems / limit),
                    currentPage: page
                });
            } catch (error) {
                res.status(500).send({ message: "Internal server error" });
            }
        });

        app.get('/reviews', VerifyFirebaseToken, async (req, res) => {
            try {
                const email = req.decoded_email; // টোকেন থেকে পাওয়া ইমেইল

                // ১. কুয়েরি প্যারামিটার থেকে পেজ এবং লিমিট নেওয়া
                const page = parseInt(req.query.page) || 1; // ডিফল্ট পেজ ১
                const limit = parseInt(req.query.limit) || 20; // প্রতি পেজে ২০টি ডেটা
                const skip = (page - 1) * limit; // কতগুলো ডেটা বাদ দিয়ে শুরু করবে

                let query = { reviewerEmail: email };

                // ২. মোট কতগুলো রিভিউ আছে তা গণনা করা (প্যাগিনেশন ক্যালকুলেশনের জন্য)
                const totalItems = await reviewsCollection.countDocuments(query);

                // ৩. নির্দিষ্ট পেজের ডেটাগুলো খুঁজে বের করা
                const reviews = await reviewsCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)   // আগের পেজের ডেটাগুলো স্কিপ করবে
                    .limit(limit) // মাত্র ২০টি ডেটা নিবে
                    .toArray();

                // ৪. ফ্রন্টএন্ডে অবজেক্ট আকারে ডেটা পাঠানো
                res.send({
                    reviews,      // বর্তমান পেজের রিভিউ লিস্ট
                    totalItems,   // মোট রিভিউ সংখ্যা
                    totalPages: Math.ceil(totalItems / limit), // মোট কতটি পেজ হবে
                    currentPage: page
                });

            } catch (error) {
                res.status(500).send({ message: "Internal server error" });
            }
        });

        app.get('/scholarship-reviews/:id', async (req, res) => {
            const scholarshipId = req.params.id;
            const result = await reviewsCollection
                .find({ scholarshipId: scholarshipId })
                .sort({ createdAt: -1 })
                .toArray();
            res.send(result);
        });

        app.post('/reviews', VerifyFirebaseToken, async (req, res) => {
            try {
                const { scholarshipId, scholarshipName, reviewComment, rating } = req.body;
                const Useremail = req.decoded_email;

                // ইউজার কালেকশন থেকে ইউজারের বর্তমান নাম ও ছবি আনা
                const user = await usersCollection.findOne({ email: Useremail });

                console.log("User found from DB:", user);

                if (user) {
                    const reviewDoc = {
                        scholarshipId,
                        scholarshipName,
                        reviewerEmail: user.email,
                        // ডাটাবেজের ফিল্ড অনুযায়ী প্রপার্টিগুলো চেক করুন
                        reviewerName: user?.displayName || "Anonymous",
                        reviewerPhoto: user?.photoURL || "",
                        reviewComment,
                        rating: rating || null,
                        createdAt: new Date()
                    };

                    const result = await reviewsCollection.insertOne(reviewDoc);
                    res.send(result);
                }
                else {
                    res.send({ message: 'User not found' })
                }

            } catch (error) {
                res.status(500).send({ message: "Failed to add review" });
            }
        });

        app.patch('/reviews/:id', VerifyFirebaseToken, async (req, res) => {
            const id = req.params.id;
            const email = req.decoded_email;
            const { rating, reviewComment } = req.body;

            // permit to modify own reviews only

            const filter = { _id: new ObjectId(id), reviewerEmail: email };
            const updateDoc = {
                $set: {
                    rating: rating,
                    reviewComment: reviewComment,
                    lastModified: new Date()
                }
            };

            const result = await reviewsCollection.updateOne(filter, updateDoc);

            if (result.matchedCount === 0) {
                return res.status(403).send({ message: "Unauthorized to edit this review" });
            }
            res.send(result);
        });

        app.delete('/reviews/:id', VerifyFirebaseToken, async (req, res) => {
            const email = req.decoded_email;
            const id = req.params.id;
            const user = await usersCollection.findOne({ email });

            // 1. if admin or moderetor then give access to delete
            if (user.role === "admin" || user.role === "moderator") {
                const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });
                return res.send(result);
            }

            // 2. if user then cheack >> is the review is him or her then permit to delete
            const query = { _id: new ObjectId(id), reviewerEmail: email };
            const result = await reviewsCollection.deleteOne(query);

            if (result.deletedCount === 0) {
                return res.status(403).send({ message: "Unauthorized to delete this review" });
            }
            res.send(result);
        });

        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Scholar Stream is streaming now !')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
